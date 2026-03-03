import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { serverApi, taskApi } from '../../services/serverApi';
import { addRecord, updateRecord, type AgentExecutionRecord } from '../../services/executionHistory';
import type { MQTask, MQTaskConfig, FailureCooldownEntry } from './types';
import {
    getOrCreateClientId,
    isAuthError,
    saveRecentlyCompleted,
    FAILURE_MAX_RETRIES,
    FAILURE_COOLDOWN_MS,
    COMPLETE_MAX_RETRIES,
    COMPLETE_RETRY_DELAYS,
    TASK_TIMEOUT_MS,
} from './utils';

/**
 * 带重试的 completeTask 调用
 * 非 401 错误自动重试最多 COMPLETE_MAX_RETRIES 次，间隔 1s -> 2s -> 4s
 * 所有重试失败后抛出最后一次的错误
 */
async function completeTaskWithRetry(
    taskInstanceId: number,
    data: { clientId: string; success: boolean; message: string },
    taskType: string,
): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= COMPLETE_MAX_RETRIES; attempt++) {
        try {
            await taskApi.completeTask(taskInstanceId, data);
            return;
        } catch (err) {
            lastErr = err;
            if (isAuthError(err)) {
                throw err;
            }
            if (attempt < COMPLETE_MAX_RETRIES) {
                const delay = COMPLETE_RETRY_DELAYS[attempt] || 4000;
                console.warn(`[Task-${taskType}] completeTask retry ${attempt + 1}/${COMPLETE_MAX_RETRIES} in ${delay}ms:`, (err as Error).message);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastErr;
}

interface UseTaskSchedulerParams {
    config: MQTaskConfig;
    isRunning: boolean;
    isRunningRef: React.MutableRefObject<boolean>;
    batchSizeRef: React.MutableRefObject<number>;
    activeCountRef: React.MutableRefObject<number>;
    isProcessingRef: React.MutableRefObject<boolean>;
    taskProcessorRef: React.MutableRefObject<(ticket: any, callbacks: any) => Promise<boolean | 'skipped'>>;
    queuedTicketIdsRef: React.MutableRefObject<Set<number>>;
    failureCooldownRef: React.MutableRefObject<Map<number, FailureCooldownEntry>>;
    recentlyCompletedRef: React.MutableRefObject<Map<number, number>>;
    agentCodeOverrideRef: React.MutableRefObject<string | undefined>;
    pollAndClaimRef: React.MutableRefObject<() => void>;
    taskQueue: MQTask[];
    batchSize: number;
    setTaskQueue: React.Dispatch<React.SetStateAction<MQTask[]>>;
    setProcessingTasks: React.Dispatch<React.SetStateAction<Map<number, MQTask>>>;
    setCompletedHistory: React.Dispatch<React.SetStateAction<MQTask[]>>;
    setLogs: React.Dispatch<React.SetStateAction<string[]>>;
}

/**
 * 任务调度 hook：处理单个任务 + 队列调度
 */
export function useTaskScheduler(params: UseTaskSchedulerParams) {
    const {
        config,
        isRunning,
        isRunningRef,
        batchSizeRef,
        activeCountRef,
        isProcessingRef,
        taskProcessorRef,
        queuedTicketIdsRef,
        failureCooldownRef,
        recentlyCompletedRef,
        agentCodeOverrideRef,
        pollAndClaimRef,
        taskQueue,
        batchSize,
        setTaskQueue,
        setProcessingTasks,
        setCompletedHistory,
        setLogs,
    } = params;

    // 通过 useRef 缓存 config，避免 useCallback 依赖不稳定的 props 引用
    const configRef = useRef(config);
    configRef.current = config;

    const scheduleNextRef = useRef<() => void>(() => {});

    // 处理单个任务
    const processOneTask = useCallback(async (task: MQTask) => {
        const cfg = configRef.current;
        console.log(`[Task-${cfg.taskType}] \u25b6 Processing ticket #${task.ticketId}, taskInstanceId=${task.taskInstanceId}`);

        setProcessingTasks(prev => {
            const next = new Map(prev);
            next.set(task.ticketId, { ...task, status: 'processing' });
            return next;
        });

        const clientId = getOrCreateClientId();
        let taskFailed = false;

        // Agent 执行记录：创建 running 记录
        const execRecordId = crypto.randomUUID();
        const resolvedAgentCode = agentCodeOverrideRef.current || task.agentCode || cfg.taskType;
        const execRecord: AgentExecutionRecord = {
            id: execRecordId,
            agentCode: resolvedAgentCode,
            agentName: resolvedAgentCode,
            capability: cfg.taskType,
            status: 'running',
            inputSummary: `Ticket #${task.ticketId} - ${task.subject}`.slice(0, 200),
            outputSummary: '',
            fullInput: JSON.stringify({ ticketId: task.ticketId, externalId: task.externalId, subject: task.subject, agentInput: task.agentInput }),
            startTime: Date.now(),
            clientId,
            ticketId: task.ticketId,
            ticketSubject: task.subject,
            routeInfo: {
                resolvedAgentCode,
                resolvedClientId: clientId,
                requiredCapability: cfg.taskType,
            },
        };
        addRecord(execRecord).catch(e => console.warn('[ExecHistory] Failed to add record:', e));

        try {
            const ticket = await serverApi.ticket.getTicketDetail(task.ticketId);
            if (!ticket) throw new Error(`Ticket #${task.ticketId} not found`);

            if (task.agentInput) {
                (ticket as any)._agentInput = task.agentInput;
                console.log(`[Task-${cfg.taskType}] Injected agentInput for ticket #${task.ticketId}`);
            }
            if (agentCodeOverrideRef.current) {
                (ticket as any)._agentCode = agentCodeOverrideRef.current;
                console.log(`[Task-${cfg.taskType}] Using panel agentCode=${agentCodeOverrideRef.current} for ticket #${task.ticketId}`);
            } else if (task.agentCode) {
                (ticket as any)._agentCode = task.agentCode;
                console.log(`[Task-${cfg.taskType}] Using workflow agentCode=${task.agentCode} for ticket #${task.ticketId}`);
            }

            // 超时保护
            let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutTimer = setTimeout(
                    () => reject(new Error(`\u4efb\u52a1\u6267\u884c\u8d85\u65f6\uff08${TASK_TIMEOUT_MS / 1000}s\uff09\uff0cAgent \u53ef\u80fd\u6302\u8d77`)),
                    TASK_TIMEOUT_MS,
                );
            });

            let result: boolean | 'skipped';
            try {
                result = await Promise.race([
                    taskProcessorRef.current(ticket, {
                        onStatusChange: (status: string | null) => console.log(`[Task-${cfg.taskType}] T#${task.ticketId} status: ${status}`),
                        onError: (err: string) => console.error(`[Task-${cfg.taskType}] T#${task.ticketId} error: ${err}`),
                        addLog: (msg: string) => setLogs(prev => [...prev.slice(-49), msg]),
                    }),
                    timeoutPromise,
                ]);
            } finally {
                clearTimeout(timeoutTimer);
            }

            if (!result) throw new Error(`${cfg.taskType} function returned false`);

            const wasSkipped = result === 'skipped';
            console.log(`[Task-${cfg.taskType}] ${wasSkipped ? '\u23ed' : '\u2705'} ${wasSkipped ? 'Skipped' : 'Completed'} ticket #${task.ticketId}`);

            // Agent 执行记录：标记成功
            const endTime = Date.now();
            const agentResultForLog = (ticket as any)?._agentResult;
            updateRecord(execRecordId, {
                status: 'completed',
                outputSummary: (typeof agentResultForLog === 'string' ? agentResultForLog : wasSkipped ? 'Skipped' : 'Completed').slice(0, 500),
                fullOutput: typeof agentResultForLog === 'string' ? agentResultForLog : undefined,
                endTime,
                durationMs: endTime - execRecord.startTime,
            }).catch(e => console.warn('[ExecHistory] Failed to update record:', e));

            // 成功时清除该 ticketId 的失败冷却记录
            failureCooldownRef.current.delete(task.ticketId);
            recentlyCompletedRef.current.set(task.ticketId, Date.now());
            saveRecentlyCompleted(cfg.taskType, recentlyCompletedRef.current);

            // 带重试的 completeTask 通知
            if (task.taskInstanceId) {
                try {
                    const agentResult = (ticket as any)?._agentResult;
                    const completionMessage = agentResult || (wasSkipped ? 'skipped' : 'completed');
                    await completeTaskWithRetry(task.taskInstanceId, {
                        clientId,
                        success: true,
                        message: completionMessage,
                    }, cfg.taskType);
                    console.log(`[Task-${cfg.taskType}] \u2705 Task complete API succeeded for ticket #${task.ticketId}, taskInstanceId=${task.taskInstanceId}`);
                } catch (ackErr) {
                    console.error(`[Task-${cfg.taskType}] \u274c Task complete API FAILED (all retries exhausted) for ticket #${task.ticketId}, taskInstanceId=${task.taskInstanceId}:`, ackErr);
                    setLogs(prev => [...prev.slice(-49), `\u274c ${cfg.taskType} #${task.ticketId} \u5b8c\u6210\u4e0a\u62a5\u5931\u8d25(\u5df2\u91cd\u8bd5${COMPLETE_MAX_RETRIES}\u6b21): ${(ackErr as Error).message || ackErr}`]);
                }
            } else {
                console.warn(`[Task-${cfg.taskType}] No taskInstanceId for ticket #${task.ticketId}, cannot notify server`);
                setLogs(prev => [...prev.slice(-49), `\u26a0\ufe0f ${cfg.taskType} #${task.ticketId} \u65e0 taskInstanceId\uff0c\u65e0\u6cd5\u901a\u77e5\u670d\u52a1\u7aef`]);
            }

            setCompletedHistory(prev => [{ ...task, status: wasSkipped ? 'skipped' as const : 'completed' as const }, ...prev].slice(0, 50));

            window.dispatchEvent(new CustomEvent('ticket-task-completed', { detail: { ticketId: task.ticketId, taskType: cfg.taskType } }));
        } catch (err: any) {
            taskFailed = true;
            console.error(`[Task-${cfg.taskType}] \u274c Failed ticket #${task.ticketId}:`, err);

            // Agent 执行记录：标记失败
            const failEndTime = Date.now();
            const isTimeout = err.message?.includes('\u8d85\u65f6') || err.message?.includes('timeout');
            updateRecord(execRecordId, {
                status: isTimeout ? 'timeout' : 'failed',
                errorMessage: err.message || String(err),
                endTime: failEndTime,
                durationMs: failEndTime - execRecord.startTime,
            }).catch(e => console.warn('[ExecHistory] Failed to update record:', e));

            // 更新失败冷却记录
            const prev = failureCooldownRef.current.get(task.ticketId);
            const newCount = (prev?.count || 0) + 1;
            failureCooldownRef.current.set(task.ticketId, {
                count: newCount,
                cooldownUntil: newCount >= FAILURE_MAX_RETRIES
                    ? Date.now() + FAILURE_COOLDOWN_MS
                    : 0,
            });
            if (newCount >= FAILURE_MAX_RETRIES) {
                console.warn(`[Task-${cfg.taskType}] Ticket #${task.ticketId} reached ${newCount} consecutive failures, cooldown ${FAILURE_COOLDOWN_MS / 1000}s`);
                setLogs(prev => [...prev.slice(-49), `\u26a0\ufe0f ${cfg.taskType} #${task.ticketId} \u8fde\u7eed\u5931\u8d25 ${newCount} \u6b21\uff0c\u51b7\u5374 ${FAILURE_COOLDOWN_MS / 1000} \u79d2`]);
            }

            // 带重试的失败通知
            if (task.taskInstanceId) {
                try {
                    await completeTaskWithRetry(task.taskInstanceId, {
                        clientId,
                        success: false,
                        message: err.message || String(err),
                    }, cfg.taskType);
                } catch (ackErr) {
                    console.error(`[Task-${cfg.taskType}] Failed to send failure ack (all retries exhausted):`, ackErr);
                }
            }

            setCompletedHistory(prev => [{
                ...task,
                status: 'failed' as const,
                error: err.message || String(err)
            }, ...prev].slice(0, 50));
        } finally {
            setProcessingTasks(prev => {
                const next = new Map(prev);
                next.delete(task.ticketId);
                return next;
            });
            queuedTicketIdsRef.current.delete(task.ticketId);

            if (cfg.concurrencyMode === 'parallel') {
                activeCountRef.current--;
            } else {
                if (taskFailed) {
                    const failDelay = Math.max(cfg.interTaskDelayMs || 0, 5000);
                    await new Promise(r => setTimeout(r, failDelay));
                }
                isProcessingRef.current = false;
            }

            if (isRunningRef.current) {
                scheduleNextRef.current();
            }

            if (isRunningRef.current && !taskFailed) {
                setTimeout(() => pollAndClaimRef.current(), 100);
            }

            window.dispatchEvent(new Event('queue-counts-refresh'));
        }
    }, []);

    // 任务调度函数
    const scheduleNext = useCallback(() => {
        if (!isRunningRef.current) return;
        setTaskQueue(currentQueue => {
            if (currentQueue.length === 0) return currentQueue;
            if (!isRunningRef.current) return currentQueue;

            if (configRef.current.concurrencyMode === 'parallel') {
                const maxConcurrent = batchSizeRef.current;
                const slotsAvailable = maxConcurrent - activeCountRef.current;
                if (slotsAvailable <= 0) return currentQueue;

                const count = Math.min(slotsAvailable, currentQueue.length);
                const tasksToStart = currentQueue.slice(0, count);

                for (const task of tasksToStart) {
                    activeCountRef.current++;
                    processOneTask(task);
                }

                return currentQueue.slice(count);
            } else {
                if (isProcessingRef.current) return currentQueue;

                let startIdx = 0;
                while (startIdx < currentQueue.length) {
                    const candidate = currentQueue[startIdx];
                    const completedAt = recentlyCompletedRef.current.get(candidate.ticketId);
                    if (completedAt && Date.now() - completedAt < 30 * 60 * 1000) {
                        queuedTicketIdsRef.current.delete(candidate.ticketId);
                        startIdx++;
                        continue;
                    }
                    break;
                }
                if (startIdx > 0) {
                    const trimmed = currentQueue.slice(startIdx);
                    if (trimmed.length === 0) return trimmed;
                }

                isProcessingRef.current = true;
                const currentTask = currentQueue[startIdx];
                if (!currentTask) {
                    isProcessingRef.current = false;
                    return currentQueue.slice(startIdx);
                }
                processOneTask(currentTask);
                return currentQueue.slice(startIdx + 1);
            }
        });
    }, [processOneTask]);

    // 保持 scheduleNextRef 始终指向最新的 scheduleNext
    useLayoutEffect(() => {
        scheduleNextRef.current = scheduleNext;
    }, [scheduleNext]);

    // 任务调度器 -- 队列变化时触发调度
    useEffect(() => {
        if (taskQueue.length === 0) return;
        if (!isRunning) return;
        scheduleNext();
    }, [taskQueue, batchSize, scheduleNext, isRunning]);
}
