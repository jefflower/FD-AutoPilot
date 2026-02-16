import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, ReactNode } from 'react';
import { serverApi, taskApi } from '../services/serverApi';

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
    startConsumer: () => void;
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

        // Refs
        const processingTasksRef = useRef(processingTasks);
        const activeCountRef = useRef(0);
        const isProcessingRef = useRef(false);
        const taskProcessorRef = useRef(taskProcessor);
        const batchSizeRef = useRef(batchSize);
        const queuedTicketIdsRef = useRef(new Set<number>());
        const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
        const isRunningRef = useRef(false);

        // 同步 refs
        useEffect(() => { processingTasksRef.current = processingTasks; }, [processingTasks]);
        useEffect(() => { taskProcessorRef.current = taskProcessor; }, [taskProcessor]);
        useEffect(() => { batchSizeRef.current = batchSize; }, [batchSize]);
        useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);

        // 核心轮询逻辑：从服务端 claim 任务
        const pollAndClaim = useCallback(async () => {
            if (!isRunningRef.current) return;

            try {
                const clientId = getOrCreateClientId();
                // 计算可用槽位
                const currentSlots = config.concurrencyMode === 'parallel'
                    ? batchSizeRef.current - activeCountRef.current
                    : (isProcessingRef.current ? 0 : 1);

                if (currentSlots <= 0) return; // 没有空闲槽位，跳过

                const claimed = await taskApi.claimTasks(config.taskType, clientId, currentSlots);
                if (claimed.length === 0) return;

                // 将 claimed TaskInstance 转换为 MQTask 并加入队列
                for (const task of claimed) {
                    let payload: any = {};
                    try { payload = JSON.parse(task.payload || '{}'); } catch { /* ignore */ }

                    const ticketId = payload.ticketId || parseInt(task.referenceId || '0');

                    // 去重检查
                    if (processingTasksRef.current.has(ticketId) || queuedTicketIdsRef.current.has(ticketId)) {
                        console.warn(`[Task-${config.taskType}] Duplicate: ticket #${ticketId}, releasing task`);
                        // 释放重复任务
                        try {
                            await taskApi.releaseTask(task.id, clientId);
                        } catch (releaseErr) {
                            console.error(`[Task-${config.taskType}] Failed to release duplicate task:`, releaseErr);
                        }
                        continue;
                    }

                    queuedTicketIdsRef.current.add(ticketId);

                    const mqTask: MQTask = {
                        ticketId,
                        externalId: payload.externalId || task.referenceId || '',
                        subject: payload.subject || 'Unknown Subject',
                        status: 'pending',
                        addedAt: Date.now(),
                        taskInstanceId: task.id,
                    };

                    setTaskQueue(prev => [...prev, mqTask]);
                }

                // 消息被消费，刷新侧边栏计数
                window.dispatchEvent(new Event('queue-counts-refresh'));
            } catch (err) {
                console.error(`[Task-${config.taskType}] Claim failed:`, err);
            }
        }, []);

        // 启动消费者
        const startConsumer = useCallback(() => {
            setIsRunning(true);
            isRunningRef.current = true;
            setLogs(prev => [...prev, `▶ ${config.taskType} 任务消费启动`]);
            // 立即执行一次 claim
            pollAndClaim();
            // 启动定时轮询
            pollTimerRef.current = setInterval(pollAndClaim, config.pollIntervalMs || 3000);
        }, [pollAndClaim]);

        // 停止消费者
        const stopConsumer = useCallback(() => {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
            setIsRunning(false);
            isRunningRef.current = false;
            setLogs(prev => [...prev, `⏹ ${config.taskType} 任务消费已停止`]);
        }, []);

        // 更新 batchSize（纯本地状态）
        const updateBatchSize = useCallback((size: number) => {
            setBatchSize(size);
        }, []);

        // 组件卸载时清理定时器
        useEffect(() => {
            return () => {
                if (pollTimerRef.current) {
                    clearInterval(pollTimerRef.current);
                }
            };
        }, []);

        // 处理单个任务
        const processOneTask = useCallback(async (task: MQTask) => {
            console.log(`[Task-${config.taskType}] ▶ Processing ticket #${task.ticketId}`);

            setProcessingTasks(prev => {
                const next = new Map(prev);
                next.set(task.ticketId, { ...task, status: 'processing' });
                return next;
            });

            const clientId = getOrCreateClientId();

            try {
                const ticket = await serverApi.ticket.getTicketDetail(task.ticketId);
                if (!ticket) throw new Error(`Ticket #${task.ticketId} not found`);

                const result = await taskProcessorRef.current(ticket, {
                    onStatusChange: (status) => console.log(`[Task-${config.taskType}] T#${task.ticketId} status: ${status}`),
                    onError: (err) => console.error(`[Task-${config.taskType}] T#${task.ticketId} error: ${err}`),
                    addLog: (msg) => setLogs(prev => [...prev.slice(-49), msg]),
                });

                if (!result) throw new Error(`${config.taskType} function returned false`);

                const wasSkipped = result === 'skipped';
                console.log(`[Task-${config.taskType}] ${wasSkipped ? '⏭' : '✅'} ${wasSkipped ? 'Skipped' : 'Completed'} ticket #${task.ticketId}`);

                // 通知服务端任务完成
                if (task.taskInstanceId) {
                    try {
                        await taskApi.completeTask(task.taskInstanceId, {
                            clientId,
                            success: true,
                            message: wasSkipped ? 'skipped' : 'completed',
                        });
                    } catch (ackErr) {
                        console.warn(`[Task-${config.taskType}] Complete API failed for ticket #${task.ticketId} (task succeeded):`, ackErr);
                    }
                }

                setCompletedHistory(prev => [{ ...task, status: wasSkipped ? 'skipped' as const : 'completed' as const }, ...prev].slice(0, 50));
            } catch (err: any) {
                console.error(`[Task-${config.taskType}] ❌ Failed ticket #${task.ticketId}:`, err);

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
                    if (config.interTaskDelayMs) {
                        await new Promise(r => setTimeout(r, config.interTaskDelayMs));
                    }
                    isProcessingRef.current = false;
                }

                // 触发重新调度
                setTaskQueue(prev => prev.length > 0 ? [...prev] : prev);

                // 通知侧边栏刷新队列计数
                window.dispatchEvent(new Event('queue-counts-refresh'));
            }
        }, []);

        // 任务调度器
        useEffect(() => {
            if (taskQueue.length === 0) return;

            if (config.concurrencyMode === 'parallel') {
                const maxConcurrent = batchSizeRef.current;
                const slotsAvailable = maxConcurrent - activeCountRef.current;
                if (slotsAvailable <= 0) return;

                const count = Math.min(slotsAvailable, taskQueue.length);
                const tasksToStart = taskQueue.slice(0, count);
                setTaskQueue(prev => prev.slice(count));

                for (const task of tasksToStart) {
                    activeCountRef.current++;
                    processOneTask(task);
                }
            } else {
                if (isProcessingRef.current) return;
                isProcessingRef.current = true;

                const currentTask = taskQueue[0];
                if (!currentTask) {
                    isProcessingRef.current = false;
                    return;
                }
                setTaskQueue(prev => prev.slice(1));
                processOneTask(currentTask);
            }
        }, [taskQueue, batchSize, processOneTask]);

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
