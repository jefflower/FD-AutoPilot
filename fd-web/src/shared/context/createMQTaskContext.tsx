import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, ReactNode } from 'react';
import { serverApi, taskApi } from '../services/serverApi';
import { useServerEvents } from './ServerEventsContext';

/**
 * 通用 MQ 任务类型
 */
export interface MQTask {
    ticketId: number;
    externalId: string;
    subject: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    error?: string;
    addedAt: number;
    taskInstanceId?: number;  // 服务端 TaskInstance ID，用于 complete/release
    agentInput?: Record<string, any>;  // 工作流 AgentTaskDelegate 注入的标准化输入
    agentCode?: string;  // 工作流指定的 Agent code（优先于 capability 解析）
}

/**
 * MQ 任务处理回调
 */
export interface TaskCallbacks {
    onStatusChange?: (status: string | null) => void;
    onError?: (error: string) => void;
    onStreamChunk?: (text: string) => void;
    addLog?: (msg: string) => void;
}

/**
 * MQ Task Context 的值类型
 */
export interface MQTaskContextType {
    taskQueue: MQTask[];
    processingTasks: Map<number, MQTask>;
    completedHistory: MQTask[];
    clearHistory: () => void;
    isRunning: boolean;
    startConsumer: (agentCode?: string) => void;
    stopConsumer: () => void;
    batchSize: number;
    updateBatchSize: (size: number) => void;
    logs: string[];
}

/**
 * MQ Task Context 静态配置（REST 轮询模式）
 */
export interface MQTaskConfig {
    taskType: string;           // 任务类型标识，如 "ticket.translate"
    defaultBatchSize: number;   // 每次 claim 的数量
    concurrencyMode: 'parallel' | 'serial';
    interTaskDelayMs?: number;  // 串行模式下任务间隔
    pollIntervalMs?: number;    // 轮询间隔，默认 3000ms
}

/**
 * Provider Props — taskProcessor 通过 prop 注入（因为它需要 React hooks）
 */
interface MQTaskProviderProps {
    children: ReactNode;
    taskProcessor: (ticket: any, callbacks: TaskCallbacks) => Promise<boolean | 'skipped'>;
}

/** 失败冷却记录 */
interface FailureCooldownEntry {
    count: number;       // 连续失败次数
    cooldownUntil: number; // 冷却到期时间戳（Date.now() 基准）
}

/** 失败冷却常量 */
const FAILURE_MAX_RETRIES = 3;         // 连续失败 N 次后进入冷却
const FAILURE_COOLDOWN_MS = 60_000;    // 冷却时长 60 秒

/** 任务执行超时（防止 Agent 挂起导致任务永远卡在 processingTasks 中） */
const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

/**
 * 获取或创建客户端唯一标识
 */
function getOrCreateClientId(): string {
    const KEY = 'fd_task_client_id';
    let clientId = localStorage.getItem(KEY);
    if (!clientId) {
        clientId = crypto.randomUUID();
        localStorage.setItem(KEY, clientId);
    }
    return clientId;
}

/**
 * MQ Task Context 工厂函数（REST 轮询模式）
 *
 * 将翻译/回复/审核 Context 的共同逻辑提取为一处。
 * 通过 REST API 轮询服务端 task claim 接口获取任务，
 * 替代原有的 Tauri MQ 事件驱动模式。
 * taskProcessor 通过 Provider prop 注入，支持在组件内使用 React hooks。
 */
export function createMQTaskContext(config: MQTaskConfig) {
    const Context = createContext<MQTaskContextType | null>(null);

    const Provider: React.FC<MQTaskProviderProps> = ({ children, taskProcessor }) => {
        const [taskQueue, setTaskQueue] = useState<MQTask[]>([]);
        const [processingTasks, setProcessingTasks] = useState<Map<number, MQTask>>(new Map());
        const [completedHistory, setCompletedHistory] = useState<MQTask[]>([]);
        const [isRunning, setIsRunning] = useState(false);
        const [batchSize, setBatchSize] = useState(config.defaultBatchSize);
        const [logs, setLogs] = useState<string[]>([]);

        // SSE 集成
        const serverEvents = useServerEvents();

        // Refs
        const processingTasksRef = useRef(processingTasks);
        const activeCountRef = useRef(0);
        const isProcessingRef = useRef(false);
        const taskProcessorRef = useRef(taskProcessor);
        const batchSizeRef = useRef(batchSize);
        const queuedTicketIdsRef = useRef(new Set<number>());
        const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
        const isRunningRef = useRef(false);
        const isPollingRef = useRef(false);  // 互斥锁：防止并发 pollAndClaim
        const emptyPollLoggedRef = useRef(false);
        const scheduleNextRef = useRef<() => void>(() => {});
        const pollAndClaimRef = useRef<() => void>(() => {});
        // 失败冷却 Map：ticketId -> { count, cooldownUntil }
        const failureCooldownRef = useRef<Map<number, FailureCooldownEntry>>(new Map());
        // Agent 面板启动时指定的 agentCode（覆盖 capability binding 默认解析）
        const agentCodeOverrideRef = useRef<string | undefined>(undefined);
        // 最近完成的 ticketId 集合（防止 claim 已完成工单的重复任务）
        const recentlyCompletedRef = useRef<Map<number, number>>(new Map()); // ticketId -> completedAt timestamp

        // 合并 4 个 ref 同步为 1 个 useLayoutEffect
        useLayoutEffect(() => {
            processingTasksRef.current = processingTasks;
            taskProcessorRef.current = taskProcessor;
            batchSizeRef.current = batchSize;
            isRunningRef.current = isRunning;
        }, [processingTasks, taskProcessor, batchSize, isRunning]);

        // 核心轮询逻辑：从服务端 claim 任务（互斥：同一时间只允许一次执行）
        const pollAndClaim = useCallback(async () => {
            if (!isRunningRef.current) return;
            if (isPollingRef.current) return;  // 互斥：有正在执行的 poll，跳过
            isPollingRef.current = true;

            try {
                const clientId = getOrCreateClientId();
                // 计算可用槽位
                const currentSlots = config.concurrencyMode === 'parallel'
                    ? batchSizeRef.current - activeCountRef.current
                    : (isProcessingRef.current ? 0 : 1);

                if (currentSlots <= 0) return; // 没有空闲槽位，跳过

                const claimed = await taskApi.claimTasks(config.taskType, clientId, currentSlots);


                if (claimed.length === 0) {
                    // 首次空结果时记录日志（避免每次轮询都刷日志）
                    if (!emptyPollLoggedRef.current) {
                        emptyPollLoggedRef.current = true;
                        setLogs(prev => [...prev.slice(-49), `⏳ ${config.taskType} 暂无待领取任务，等待中...`]);
                    }
                    return;
                }
                emptyPollLoggedRef.current = false; // 有结果时重置

                // 将 claimed TaskInstance 转换为 MQTask 并加入队列
                for (const task of claimed) {
                    let payload: any = {};
                    try { payload = JSON.parse(task.payload || '{}'); } catch { /* ignore */ }

                    const ticketId = payload.ticketId || parseInt(task.referenceId || '0');

                    // 去重检查：任务已在执行中、队列中或最近已完成，直接跳过（不 release）
                    // 服务端 claimTasks 会返回已 CLAIMED 的任务（"你已拥有此任务"语义），
                    // 此时不能 release，否则正在执行的 Agent 完成后 completeTask 会失败
                    if (processingTasksRef.current.has(ticketId) || queuedTicketIdsRef.current.has(ticketId)) {
                        continue;
                    }

                    // 最近完成的工单去重（30 分钟内完成的工单不再领取同类型任务）
                    const completedAt = recentlyCompletedRef.current.get(ticketId);
                    if (completedAt && Date.now() - completedAt < 30 * 60 * 1000) {
                        continue;
                    }

                    // 失败冷却检查：同一 ticketId 连续失败超过阈值，冷却期内跳过
                    const cooldownEntry = failureCooldownRef.current.get(ticketId);
                    if (cooldownEntry && cooldownEntry.count >= FAILURE_MAX_RETRIES) {
                        if (Date.now() < cooldownEntry.cooldownUntil) {
                            const remainSec = Math.ceil((cooldownEntry.cooldownUntil - Date.now()) / 1000);
                            console.warn(`[Task-${config.taskType}] Ticket #${ticketId} in cooldown (${cooldownEntry.count} failures, ${remainSec}s remaining), releasing task`);
                            try {
                                await taskApi.releaseTask(task.id, clientId);
                            } catch (releaseErr) {
                                console.error(`[Task-${config.taskType}] Failed to release cooldown task:`, releaseErr);
                            }
                            continue;
                        }
                        // 冷却已过期，清除记录，允许重试
                        failureCooldownRef.current.delete(ticketId);
                    }

                    queuedTicketIdsRef.current.add(ticketId);

                    const mqTask: MQTask = {
                        ticketId,
                        externalId: payload.externalId || task.referenceId || '',
                        subject: payload.subject || 'Unknown Subject',
                        status: 'pending',
                        addedAt: Date.now(),
                        taskInstanceId: task.id,
                        agentInput: payload.agentInput || undefined,  // 工作流标准化输入
                        agentCode: payload.agentCode || undefined,    // 工作流指定的 Agent code
                    };

                    setTaskQueue(prev => {
                        // 队列级去重（防御性兜底）
                        if (prev.some(t => t.ticketId === mqTask.ticketId)) return prev;
                        return [...prev, mqTask];
                    });
                }

                // 消息被消费，刷新侧边栏计数
                window.dispatchEvent(new Event('queue-counts-refresh'));
            } catch (err) {
                console.error(`[Task-${config.taskType}] Claim failed:`, err);
                setLogs(prev => [...prev.slice(-49), `❌ ${config.taskType} 任务领取失败: ${(err as Error).message}`]);
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
                // 只处理匹配当前 taskType 的事件
                if (data?.taskType === config.taskType) {
                    console.log(`[SSE→Task] Received task-available for ${config.taskType}, triggering immediate claim`);
                    pollAndClaimRef.current();
                }
            });
        }, [serverEvents, isRunning]);

        // 消费者运行时维持固定轮询（唯一的定时器管理点）
        useEffect(() => {
            if (!isRunning) {
                // 停止时清理定时器
                if (pollTimerRef.current) {
                    clearInterval(pollTimerRef.current);
                    pollTimerRef.current = null;
                }
                return;
            }

            // 启动时：立即执行一次 claim + 创建固定轮询
            pollAndClaimRef.current();
            const interval = config.pollIntervalMs || 5000;
            pollTimerRef.current = setInterval(() => pollAndClaimRef.current(), interval);
            console.log(`[Task-${config.taskType}] Poll timer started: ${interval}ms`);

            return () => {
                if (pollTimerRef.current) {
                    clearInterval(pollTimerRef.current);
                    pollTimerRef.current = null;
                }
            };
        }, [isRunning]);

        // 启动消费者（仅设置状态，定时器由 useEffect[isRunning] 统一管理）
        const startConsumer = useCallback((agentCode?: string) => {
            agentCodeOverrideRef.current = agentCode;
            setIsRunning(true);
            isRunningRef.current = true;
            emptyPollLoggedRef.current = false;
            const agentLabel = agentCode ? ` (agent: ${agentCode})` : '';
            setLogs(prev => [...prev, `▶ ${config.taskType} 任务消费启动${agentLabel}`]);
        }, []);

        // 停止消费者（定时器由 useEffect[isRunning] 统一清理）
        const stopConsumer = useCallback(() => {
            setIsRunning(false);
            isRunningRef.current = false;
            agentCodeOverrideRef.current = undefined;
            // 清空队列并释放已领取但未执行的任务
            const clientId = getOrCreateClientId();
            setTaskQueue(prev => {
                for (const task of prev) {
                    if (task.taskInstanceId) {
                        taskApi.releaseTask(task.taskInstanceId, clientId).catch(err =>
                            console.warn(`[Task-${config.taskType}] Release failed:`, err));
                    }
                    queuedTicketIdsRef.current.delete(task.ticketId);
                }
                return [];
            });
            setLogs(prev => [...prev, `⏹ ${config.taskType} 任务消费已停止`]);
        }, []);

        // 更新 batchSize（纯本地状态）
        const updateBatchSize = useCallback((size: number) => {
            setBatchSize(size);
        }, []);

        // 处理单个任务
        const processOneTask = useCallback(async (task: MQTask) => {
            console.log(`[Task-${config.taskType}] ▶ Processing ticket #${task.ticketId}, taskInstanceId=${task.taskInstanceId}`);

            setProcessingTasks(prev => {
                const next = new Map(prev);
                next.set(task.ticketId, { ...task, status: 'processing' });
                return next;
            });

            const clientId = getOrCreateClientId();
            let taskFailed = false; // 本地变量追踪失败状态，用于 finally 中判断是否快速重试

            try {
                const ticket = await serverApi.ticket.getTicketDetail(task.ticketId);
                if (!ticket) throw new Error(`Ticket #${task.ticketId} not found`);

                // 注入工作流标准化输入（如果 payload 中包含 agentInput）
                if (task.agentInput) {
                    (ticket as any)._agentInput = task.agentInput;
                    console.log(`[Task-${config.taskType}] Injected agentInput for ticket #${task.ticketId}`);
                }
                // Agent 面板显式指定的 agentCode 最高优先（用户从面板启动特定 Agent）
                // 工作流注入的 agentCode 次之（BPMN AgentTaskDelegate 指定）
                // 都没有时由 capability binding 解析
                if (agentCodeOverrideRef.current) {
                    (ticket as any)._agentCode = agentCodeOverrideRef.current;
                    console.log(`[Task-${config.taskType}] Using panel agentCode=${agentCodeOverrideRef.current} for ticket #${task.ticketId}`);
                } else if (task.agentCode) {
                    (ticket as any)._agentCode = task.agentCode;
                    console.log(`[Task-${config.taskType}] Using workflow agentCode=${task.agentCode} for ticket #${task.ticketId}`);
                }

                // 超时保护：防止 Agent 执行挂起（如 Tauri invoke 超时、网络无响应）
                let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
                const timeoutPromise = new Promise<never>((_, reject) => {
                    timeoutTimer = setTimeout(
                        () => reject(new Error(`任务执行超时（${TASK_TIMEOUT_MS / 1000}s），Agent 可能挂起`)),
                        TASK_TIMEOUT_MS,
                    );
                });

                let result: boolean | 'skipped';
                try {
                    result = await Promise.race([
                        taskProcessorRef.current(ticket, {
                            onStatusChange: (status) => console.log(`[Task-${config.taskType}] T#${task.ticketId} status: ${status}`),
                            onError: (err) => console.error(`[Task-${config.taskType}] T#${task.ticketId} error: ${err}`),
                            addLog: (msg) => setLogs(prev => [...prev.slice(-49), msg]),
                        }),
                        timeoutPromise,
                    ]);
                } finally {
                    clearTimeout(timeoutTimer);
                }

                if (!result) throw new Error(`${config.taskType} function returned false`);

                const wasSkipped = result === 'skipped';
                console.log(`[Task-${config.taskType}] ${wasSkipped ? '⏭' : '✅'} ${wasSkipped ? 'Skipped' : 'Completed'} ticket #${task.ticketId}`);

                // 成功时清除该 ticketId 的失败冷却记录，并记录为最近完成（防止重复 claim）
                failureCooldownRef.current.delete(task.ticketId);
                recentlyCompletedRef.current.set(task.ticketId, Date.now());

                // 通知服务端任务完成（触发 WorkflowTaskBridge → signal ReceiveTask → 推进 BPMN）
                if (task.taskInstanceId) {
                    try {
                        await taskApi.completeTask(task.taskInstanceId, {
                            clientId,
                            success: true,
                            message: wasSkipped ? 'skipped' : 'completed',
                        });
                        console.log(`[Task-${config.taskType}] ✅ Task complete API succeeded for ticket #${task.ticketId}, taskInstanceId=${task.taskInstanceId}`);
                    } catch (ackErr) {
                        // 如果 complete API 失败，后端 TaskInstance 仍为 CLAIMED，BPMN ReceiveTask 不会被 signal，工作流会卡住
                        console.error(`[Task-${config.taskType}] ❌ Task complete API FAILED for ticket #${task.ticketId}, taskInstanceId=${task.taskInstanceId}:`, ackErr);
                        setLogs(prev => [...prev.slice(-49), `❌ ${config.taskType} #${task.ticketId} 完成上报失败: ${(ackErr as Error).message || ackErr}`]);
                    }
                } else {
                    console.warn(`[Task-${config.taskType}] No taskInstanceId for ticket #${task.ticketId}, cannot notify server`);
                    setLogs(prev => [...prev.slice(-49), `⚠️ ${config.taskType} #${task.ticketId} 无 taskInstanceId，无法通知服务端`]);
                }

                setCompletedHistory(prev => [{ ...task, status: wasSkipped ? 'skipped' as const : 'completed' as const }, ...prev].slice(0, 50));

                // 通知工单详情页刷新（ticket-task-completed 事件携带 ticketId）
                window.dispatchEvent(new CustomEvent('ticket-task-completed', { detail: { ticketId: task.ticketId, taskType: config.taskType } }));
            } catch (err: any) {
                taskFailed = true;
                console.error(`[Task-${config.taskType}] ❌ Failed ticket #${task.ticketId}:`, err);

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
                    console.warn(`[Task-${config.taskType}] Ticket #${task.ticketId} reached ${newCount} consecutive failures, cooldown ${FAILURE_COOLDOWN_MS / 1000}s`);
                    setLogs(prev => [...prev.slice(-49), `⚠️ ${config.taskType} #${task.ticketId} 连续失败 ${newCount} 次，冷却 ${FAILURE_COOLDOWN_MS / 1000} 秒`]);
                }

                // 通知服务端任务失败
                if (task.taskInstanceId) {
                    try {
                        await taskApi.completeTask(task.taskInstanceId, {
                            clientId,
                            success: false,
                            message: err.message || String(err),
                        });
                    } catch (ackErr) {
                        console.error(`[Task-${config.taskType}] Failed to send failure ack:`, ackErr);
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

                if (config.concurrencyMode === 'parallel') {
                    activeCountRef.current--;
                } else {
                    // 仅失败任务施加间隔延迟（防止快速失败循环），成功任务立即释放
                    if (taskFailed && config.interTaskDelayMs) {
                        await new Promise(r => setTimeout(r, config.interTaskDelayMs));
                    }
                    isProcessingRef.current = false;
                }

                // 触发重新调度（停止后不再调度新任务）
                if (isRunningRef.current) {
                    scheduleNextRef.current();
                }

                // 成功完成时：100ms 后立即领取下一个任务（保持吞吐量）
                // 失败时：不立即重试，等待 5s 定时轮询（防止快速失败循环导致渲染风暴）
                if (isRunningRef.current && !taskFailed) {
                    setTimeout(() => pollAndClaimRef.current(), 100);
                }

                // 通知侧边栏刷新队列计数
                window.dispatchEvent(new Event('queue-counts-refresh'));
            }
        }, []);

        // 任务调度函数（提取为独立函数，供 scheduleNextRef 调用）
        const scheduleNext = useCallback(() => {
            if (!isRunningRef.current) return;  // 停止后不再调度新任务
            setTaskQueue(currentQueue => {
                if (currentQueue.length === 0) return currentQueue;
                if (!isRunningRef.current) return currentQueue;  // 二次检查（闭包竞态）

                if (config.concurrencyMode === 'parallel') {
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

                    // 跳过队列头部已在 recentlyCompleted 中的任务（防御性兜底）
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
                        // 移除已跳过的任务
                        const trimmed = currentQueue.slice(startIdx);
                        if (trimmed.length === 0) return trimmed;
                        // 递归不需要，直接继续处理 trimmed[0]
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

        // 任务调度器 — 队列变化时触发调度（停止后不再调度）
        useEffect(() => {
            if (taskQueue.length === 0) return;
            if (!isRunning) return;
            scheduleNext();
        }, [taskQueue, batchSize, scheduleNext, isRunning]);

        const clearHistory = useCallback(() => {
            setCompletedHistory([]);
        }, []);

        const contextValue = useMemo<MQTaskContextType>(() => ({
            taskQueue,
            processingTasks,
            completedHistory,
            clearHistory,
            isRunning,
            startConsumer,
            stopConsumer,
            batchSize,
            updateBatchSize,
            logs
        }), [
            taskQueue,
            processingTasks,
            completedHistory,
            clearHistory,
            isRunning,
            startConsumer,
            stopConsumer,
            batchSize,
            updateBatchSize,
            logs
        ]);

        return (
            <Context.Provider value={contextValue}>
                {children}
            </Context.Provider>
        );
    };

    const useTaskContext = () => {
        const context = useContext(Context);
        if (!context) throw new Error(`useMQTask(${config.taskType}) must be used within its Provider`);
        return context;
    };

    return { Provider, useTaskContext };
}
