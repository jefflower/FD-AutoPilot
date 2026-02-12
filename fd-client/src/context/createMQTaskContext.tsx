import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { serverApi, configApi } from '../services/serverApi';

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
 * MQ Task Context 静态配置（不含需要 Hook 的部分）
 */
export interface MQTaskConfig {
    taskType: string;
    eventName: string;
    startCommand: string;
    stopCommand: string;
    statusCommand: string;
    completeCommand: string;
    defaultBatchSize: number;
    concurrencyMode: 'parallel' | 'serial';
    interTaskDelayMs?: number;
}

/**
 * Provider Props — taskProcessor 通过 prop 注入（因为它需要 React hooks）
 */
interface MQTaskProviderProps {
    children: ReactNode;
    taskProcessor: (ticket: any, callbacks: TaskCallbacks) => Promise<boolean | 'skipped'>;
}

/**
 * MQ Task Context 工厂函数
 *
 * 将翻译/回复 Context 的共同逻辑提取为一处。
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

        // 同步 refs
        useEffect(() => { processingTasksRef.current = processingTasks; }, [processingTasks]);
        useEffect(() => { taskProcessorRef.current = taskProcessor; }, [taskProcessor]);
        useEffect(() => { batchSizeRef.current = batchSize; }, [batchSize]);

        // 轮询消费者状态
        const checkStatus = useCallback(async () => {
            try {
                const status = await invoke<{ isRunning: boolean; batchSize: number }>(config.statusCommand);
                setIsRunning(status.isRunning);
                setBatchSize(status.batchSize);
            } catch (err) {
                console.error(`[MQ-${config.taskType}] Failed to get status:`, err);
            }
        }, []);

        useEffect(() => {
            checkStatus();
            const interval = setInterval(checkStatus, 3000);
            return () => clearInterval(interval);
        }, [checkStatus]);

        // 监听日志
        useEffect(() => {
            let unlisten: (() => void) | null = null;
            listen<string>('log', (event) => {
                setLogs(prev => [...prev.slice(-49), event.payload]);
            }).then(fn => { unlisten = fn; });
            return () => { if (unlisten) unlisten(); };
        }, []);

        // 启动消费者（先从服务端同步队列名到本地）
        const startConsumer = useCallback(async () => {
            try {
                // 从服务端获取最新队列配置，同步到本地 Tauri 存储
                try {
                    const mqConfig = await configApi.getMqQueues();
                    await invoke('sync_mq_queues_cmd', {
                        queueTranslation: mqConfig.queueTranslation || 'q.ticket.translation',
                        queueReply: mqConfig.queueReply || 'q.ticket.reply',
                        queueAudit: mqConfig.queueAudit || 'q.ticket.audit',
                        queueDlq: mqConfig.queueDlq || 'q.ticket.dlq',
                    });
                    setLogs(prev => [...prev, `📡 队列配置已从服务端同步`]);
                } catch {
                    setLogs(prev => [...prev, `⚠️ 无法从服务端同步队列配置，使用本地缓存`]);
                }

                const authToken = localStorage.getItem('fd_auth_token') || '';
                await invoke(config.startCommand, { authToken });
                setLogs(prev => [...prev, `🐰 ${config.taskType} MQ 消费启动中...`]);
                setTimeout(() => checkStatus(), 1500);
            } catch (err: any) {
                setLogs(prev => [...prev, `❌ 启动失败: ${err.message || err}`]);
            }
        }, [checkStatus]);

        // 停止消费者
        const stopConsumer = useCallback(async () => {
            try {
                await invoke(config.stopCommand);
                setLogs(prev => [...prev, `🛑 ${config.taskType} MQ 消费已停止`]);
                setIsRunning(false);
            } catch (err: any) {
                setLogs(prev => [...prev, `❌ 停止失败: ${err.message || err}`]);
            }
        }, []);

        // 更新 batchSize
        const updateBatchSize = useCallback(async (size: number) => {
            try {
                await invoke('update_mq_batch_size', { batchSize: size });
                setBatchSize(size);
            } catch (err) {
                console.error(`[MQ-${config.taskType}] Failed to update batch size:`, err);
            }
        }, []);

        // 监听 MQ 事件
        useEffect(() => {
            const unlistenPromise = listen<any>(config.eventName, (event) => {
                const raw = event.payload;
                console.log(`[MQ-${config.taskType}] Received ${config.eventName}:`, raw);

                let data: any;
                if (typeof raw === 'string') {
                    try { data = JSON.parse(raw); }
                    catch (e) { console.error(`[MQ-${config.taskType}] Failed to parse payload:`, e); return; }
                } else {
                    data = raw;
                }

                const ticketId = data.ticketId;
                if (!ticketId) {
                    console.warn(`[MQ-${config.taskType}] Invalid payload, no ticketId:`, data);
                    return;
                }

                // 同步去重
                if (processingTasksRef.current.has(ticketId) || queuedTicketIdsRef.current.has(ticketId)) {
                    console.warn(`[MQ-${config.taskType}] Duplicate: ticket #${ticketId}`);
                    return;
                }

                queuedTicketIdsRef.current.add(ticketId);

                const newTask: MQTask = {
                    ticketId,
                    externalId: data.externalId || `ID-${ticketId}`,
                    subject: data.subject || 'Unknown Subject',
                    status: 'pending',
                    addedAt: Date.now()
                };

                setTaskQueue(prev => [...prev, newTask]);

                // 消息被消费，队列 ready 数已变化，刷新侧边栏计数
                window.dispatchEvent(new Event('queue-counts-refresh'));
            });

            return () => { unlistenPromise.then(fn => fn()); };
        }, []);

        // 处理单个任务
        const processOneTask = useCallback(async (task: MQTask) => {
            console.log(`[MQ-${config.taskType}] ▶ Processing ticket #${task.ticketId}`);

            setProcessingTasks(prev => {
                const next = new Map(prev);
                next.set(task.ticketId, { ...task, status: 'processing' });
                return next;
            });

            try {
                const ticket = await serverApi.ticket.getTicketDetail(task.ticketId);
                if (!ticket) throw new Error(`Ticket #${task.ticketId} not found`);

                const result = await taskProcessorRef.current(ticket, {
                    onStatusChange: (status) => console.log(`[MQ-${config.taskType}] T#${task.ticketId} status: ${status}`),
                    onError: (err) => console.error(`[MQ-${config.taskType}] T#${task.ticketId} error: ${err}`),
                    addLog: (msg) => setLogs(prev => [...prev.slice(-49), msg]),
                });

                if (!result) throw new Error(`${config.taskType} function returned false`);

                const wasSkipped = result === 'skipped';
                console.log(`[MQ-${config.taskType}] ${wasSkipped ? '⏭' : '✅'} ${wasSkipped ? 'Skipped' : 'Completed'} ticket #${task.ticketId}`);

                // 任务本身已成功 — ACK invoke 失败不应覆盖任务结果（例如 consumer 已停止导致 pending_acks 被清理）
                try {
                    await invoke(config.completeCommand, { ticketId: task.ticketId, success: true });
                } catch (ackErr) {
                    console.warn(`[MQ-${config.taskType}] ACK invoke failed for ticket #${task.ticketId} (task succeeded, consumer may have stopped):`, ackErr);
                }

                setCompletedHistory(prev => [{ ...task, status: wasSkipped ? 'skipped' as const : 'completed' as const }, ...prev].slice(0, 50));
            } catch (err: any) {
                console.error(`[MQ-${config.taskType}] ❌ Failed ticket #${task.ticketId}:`, err);

                try {
                    await invoke(config.completeCommand, { ticketId: task.ticketId, success: false });
                } catch (ackErr) {
                    console.error(`[MQ-${config.taskType}] Failed to send failure ack:`, ackErr);
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
