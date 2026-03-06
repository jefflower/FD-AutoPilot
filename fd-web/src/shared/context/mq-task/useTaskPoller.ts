import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { taskApi } from '../../services/serverApi';
import { useServerEvents } from '../ServerEventsContext';
import { usePollingControl } from '../../hooks/usePollingControl';
import type { MQTask, MQTaskConfig, FailureCooldownEntry } from './types';
import {
    getOrCreateClientId,
    isNetworkError,
    isAuthError,
    CLAIM_BACKOFF_INITIAL_MS,
    CLAIM_BACKOFF_MAX_MS,
    SSE_DISCONNECTED_POLL_MS,
} from './utils';

interface UseTaskPollerParams {
    config: MQTaskConfig;
    isRunning: boolean;
    setIsRunning: React.Dispatch<React.SetStateAction<boolean>>;
    isRunningRef: React.MutableRefObject<boolean>;
    batchSizeRef: React.MutableRefObject<number>;
    activeCountRef: React.MutableRefObject<number>;
    isProcessingRef: React.MutableRefObject<boolean>;
    processingTasksRef: React.MutableRefObject<Map<number, MQTask>>;
    queuedTicketIdsRef: React.MutableRefObject<Set<number>>;
    failureCooldownRef: React.MutableRefObject<Map<number, FailureCooldownEntry>>;
    recentlyCompletedRef: React.MutableRefObject<Map<number, number>>;
    setTaskQueue: React.Dispatch<React.SetStateAction<MQTask[]>>;
    setLogs: React.Dispatch<React.SetStateAction<string[]>>;
}

/**
 * 核心轮询 hook：从服务端 claim 任务，并维持轮询 + SSE 事件订阅
 *
 * 返回 pollAndClaimRef（可供外部触发即时 claim）
 */
export function useTaskPoller(params: UseTaskPollerParams) {
    const {
        config,
        isRunning,
        setIsRunning,
        isRunningRef,
        batchSizeRef,
        activeCountRef,
        isProcessingRef,
        processingTasksRef,
        queuedTicketIdsRef,
        failureCooldownRef,
        recentlyCompletedRef,
        setTaskQueue,
        setLogs,
    } = params;

    // 通过 useRef 缓存 config，避免 useCallback 依赖不稳定的 props 引用
    const configRef = useRef(config);
    configRef.current = config;

    // SSE 集成
    const serverEvents = useServerEvents();
    const sseStatus = serverEvents?.status ?? 'disconnected';

    // 全局轮询控制
    const { pollingPaused } = usePollingControl();

    const isPollingRef = useRef(false);
    const emptyPollLoggedRef = useRef(false);
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollAndClaimRef = useRef<() => void>(() => {});
    const claimBackoffRef = useRef(0);

    // 核心轮询逻辑：从服务端 claim 任务（互斥：同一时间只允许一次执行）
    const pollAndClaim = useCallback(async () => {
        if (!isRunningRef.current) return;
        if (isPollingRef.current) return;
        isPollingRef.current = true;

        const cfg = configRef.current;

        try {
            const clientId = getOrCreateClientId();
            const currentSlots = cfg.concurrencyMode === 'parallel'
                ? batchSizeRef.current - activeCountRef.current
                : (isProcessingRef.current ? 0 : 1);

            if (currentSlots <= 0) return;

            const claimed = await taskApi.claimTasks(cfg.taskType, clientId, currentSlots);

            // claim 成功，重置退避
            claimBackoffRef.current = 0;

            if (claimed.length === 0) {
                if (!emptyPollLoggedRef.current) {
                    emptyPollLoggedRef.current = true;
                    setLogs(prev => [...prev.slice(-49), `\u23f3 ${cfg.taskType} \u6682\u65e0\u5f85\u9886\u53d6\u4efb\u52a1\uff0c\u7b49\u5f85\u4e2d...`]);
                }
                return;
            }
            emptyPollLoggedRef.current = false;

            for (const task of claimed) {
                let payload: any = {};
                try { payload = JSON.parse(task.payload || '{}'); } catch { /* ignore */ }

                // agentInput 中包含 n8n 注入的 ticketId/externalId/subject 等字段
                const agentInput = payload.agentInput || {};

                const ticketId = payload.ticketId || agentInput.ticketId || parseInt(task.referenceId || '0');

                if (processingTasksRef.current.has(ticketId) || queuedTicketIdsRef.current.has(ticketId)) {
                    continue;
                }

                const completedAt = recentlyCompletedRef.current.get(ticketId);
                if (completedAt && Date.now() - completedAt < 30 * 60 * 1000) {
                    continue;
                }

                const cooldownEntry = failureCooldownRef.current.get(ticketId);
                if (cooldownEntry && cooldownEntry.count >= 3) {
                    if (Date.now() < cooldownEntry.cooldownUntil) {
                        const remainSec = Math.ceil((cooldownEntry.cooldownUntil - Date.now()) / 1000);
                        console.warn(`[Task-${cfg.taskType}] Ticket #${ticketId} in cooldown (${cooldownEntry.count} failures, ${remainSec}s remaining), releasing task`);
                        try {
                            await taskApi.releaseTask(task.id, clientId);
                        } catch (releaseErr) {
                            console.error(`[Task-${cfg.taskType}] Failed to release cooldown task:`, releaseErr);
                        }
                        continue;
                    }
                    failureCooldownRef.current.delete(ticketId);
                }

                queuedTicketIdsRef.current.add(ticketId);

                const mqTask: MQTask = {
                    ticketId,
                    externalId: payload.externalId || agentInput.externalId || task.referenceId || '',
                    subject: payload.subject || agentInput.subject || 'Unknown Subject',
                    status: 'pending',
                    addedAt: Date.now(),
                    taskInstanceId: task.id,
                    agentInput: agentInput || undefined,
                    agentCode: payload.agentCode || undefined,
                };

                setTaskQueue(prev => {
                    if (prev.some(t => t.ticketId === mqTask.ticketId)) return prev;
                    return [...prev, mqTask];
                });
            }

            window.dispatchEvent(new Event('queue-counts-refresh'));
        } catch (err) {
            if (isAuthError(err)) {
                console.error(`[Task-${cfg.taskType}] Auth error during claim, stopping consumer:`, err);
                setLogs(prev => [...prev.slice(-49), `\u274c ${cfg.taskType} \u8ba4\u8bc1\u5931\u8d25\uff0c\u6d88\u8d39\u5df2\u505c\u6b62`]);
                setTimeout(() => {
                    setIsRunning(false);
                    isRunningRef.current = false;
                }, 0);
                return;
            }

            if (isNetworkError(err)) {
                claimBackoffRef.current = Math.min(claimBackoffRef.current + 1, 5);
                const backoffMs = Math.min(
                    CLAIM_BACKOFF_INITIAL_MS * Math.pow(2, claimBackoffRef.current - 1),
                    CLAIM_BACKOFF_MAX_MS,
                );
                console.warn(`[Task-${cfg.taskType}] Network error during claim, backoff ${backoffMs}ms (level ${claimBackoffRef.current}):`, (err as Error).message);
                setLogs(prev => [...prev.slice(-49), `\u26a0\ufe0f ${cfg.taskType} \u7f51\u7edc\u5f02\u5e38\uff0c${Math.round(backoffMs / 1000)}s \u540e\u91cd\u8bd5...`]);
                if (isRunningRef.current) {
                    setTimeout(() => pollAndClaimRef.current(), backoffMs);
                }
                return;
            }

            console.error(`[Task-${cfg.taskType}] Claim failed:`, err);
            setLogs(prev => [...prev.slice(-49), `\u274c ${cfg.taskType} \u4efb\u52a1\u9886\u53d6\u5931\u8d25: ${(err as Error).message}`]);
        } finally {
            isPollingRef.current = false;
        }
    }, []);

    // 保持 pollAndClaimRef 指向最新
    useLayoutEffect(() => {
        pollAndClaimRef.current = pollAndClaim;
    }, [pollAndClaim]);

    // SSE 事件订阅：收到 task-available 时立即触发 claim
    useEffect(() => {
        if (!serverEvents || !isRunning) return;

        return serverEvents.subscribe('task-available', (data: any) => {
            if (data?.taskType === configRef.current.taskType) {
                console.log(`[SSE\u2192Task] Received task-available for ${configRef.current.taskType}, triggering immediate claim`);
                pollAndClaimRef.current();
            }
        });
    }, [serverEvents, isRunning]);

    // 消费者运行时维持轮询 + SSE 断线自适应间隔（pollingPaused 时停止）
    useEffect(() => {
        if (!isRunning || pollingPaused) {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
            return;
        }

        pollAndClaimRef.current();

        const baseInterval = configRef.current.pollIntervalMs || 5000;
        const interval = sseStatus !== 'connected' ? Math.min(SSE_DISCONNECTED_POLL_MS, baseInterval) : baseInterval;

        pollTimerRef.current = setInterval(() => pollAndClaimRef.current(), interval);
        console.log(`[Task-${configRef.current.taskType}] Poll timer started: ${interval}ms (SSE: ${sseStatus})`);

        return () => {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
        };
    }, [isRunning, pollingPaused, sseStatus]);

    return { pollAndClaimRef, claimBackoffRef, emptyPollLoggedRef };
}
