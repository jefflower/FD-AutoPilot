
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { serverApi } from '../services/serverApi';
import { useAiTranslation } from '../hooks/useAiTranslation';

export interface TranslationTask {
    ticketId: number;
    externalId: string;
    subject: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
    addedAt: number;
}

interface MQTranslationContextType {
    translationQueue: TranslationTask[];
    processingTasks: Map<number, TranslationTask>;
    completedHistory: TranslationTask[];
    clearHistory: () => void;
    // Control & Status
    isRunning: boolean;
    startConsumer: () => void;
    stopConsumer: () => void;
    batchSize: number;
    updateBatchSize: (size: number) => void;
    logs: string[];
}

const MQTranslationContext = createContext<MQTranslationContextType | null>(null);

export const MQTranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [translationQueue, setTranslationQueue] = useState<TranslationTask[]>([]);
    const [processingTasks, setProcessingTasks] = useState<Map<number, TranslationTask>>(new Map());
    const [completedHistory, setCompletedHistory] = useState<TranslationTask[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [batchSize, setBatchSize] = useState(5);
    const [logs, setLogs] = useState<string[]>([]);

    // Core Hook
    const { runTranslation } = useAiTranslation();

    // Refs: 避免闭包陈旧问题
    const processingTasksRef = useRef(processingTasks);
    const activeCountRef = useRef(0); // 当前并发执行中的任务数
    const runTranslationRef = useRef(runTranslation);
    const batchSizeRef = useRef(batchSize);
    const queuedTicketIdsRef = useRef(new Set<number>()); // 同步去重

    // 同步 refs
    useEffect(() => { processingTasksRef.current = processingTasks; }, [processingTasks]);
    useEffect(() => { runTranslationRef.current = runTranslation; }, [runTranslation]);
    useEffect(() => { batchSizeRef.current = batchSize; }, [batchSize]);

    // 轮询 MQ 状态
    const checkStatus = useCallback(async () => {
        try {
            const status = await invoke<{ isRunning: boolean; batchSize: number }>('get_mq_consumer_status');
            setIsRunning(status.isRunning);
            setBatchSize(status.batchSize);
        } catch (err) {
            console.error('[MQTranslationContext] Failed to get MQ status:', err);
        }
    }, []);

    useEffect(() => {
        checkStatus();
        const interval = setInterval(checkStatus, 3000);
        return () => clearInterval(interval);
    }, [checkStatus]);

    // 监听日志事件
    useEffect(() => {
        let unlisten: (() => void) | null = null;
        listen<string>('log', (event) => {
            setLogs(prev => [...prev.slice(-49), event.payload]);
        }).then((fn) => {
            unlisten = fn;
        });

        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    const startConsumer = useCallback(async () => {
        try {
            const authToken = localStorage.getItem('fd_auth_token') || '';
            await invoke('start_mq_consumer', { authToken });
            setLogs(prev => [...prev, '🐰 MQ 消费启动中...']);
            // 不立即设置 isRunning=true，实际连接在 tokio::spawn 中异步执行
            // 延迟检查真实状态（连接成功 is_running=true，连接失败 is_running=false）
            setTimeout(() => checkStatus(), 1500);
        } catch (err: any) {
            console.error('Failed to start consumer:', err);
            setLogs(prev => [...prev, `❌ 启动失败: ${err.message || err}`]);
        }
    }, [checkStatus]);

    const stopConsumer = useCallback(async () => {
        try {
            await invoke('stop_mq_consumer');
            setLogs(prev => [...prev, '🛑 MQ 消费已停止']);
            setIsRunning(false);
        } catch (err: any) {
            console.error('Failed to stop consumer:', err);
            setLogs(prev => [...prev, `❌ 停止失败: ${err.message || err}`]);
        }
    }, []);

    const updateBatchSize = useCallback(async (size: number) => {
        try {
            await invoke('update_mq_batch_size', { batchSize: size });
            setBatchSize(size);
        } catch (err) {
            console.error('Failed to update batch size:', err);
        }
    }, []);

    // 监听 MQ 事件 - 空依赖，只注册一次，使用 ref 做去重
    useEffect(() => {
        const unlistenPromise = listen<any>('mq-translate-request', (event) => {
            const raw = event.payload;
            console.log('[MQTranslationContext] Received mq-translate-request:', raw);

            // 兼容 string 和 object 两种载荷格式
            let data: any;
            if (typeof raw === 'string') {
                try {
                    data = JSON.parse(raw);
                } catch (e) {
                    console.error('[MQTranslationContext] Failed to parse payload string:', e);
                    return;
                }
            } else {
                data = raw;
            }

            const ticketId = data.ticketId;
            if (!ticketId) {
                console.warn('[MQTranslationContext] Invalid payload, no ticketId:', data);
                return;
            }

            // 同步 ref 去重（防止 React 批量更新期间事件回调连续触发导致重复入队）
            if (processingTasksRef.current.has(ticketId) || queuedTicketIdsRef.current.has(ticketId)) {
                console.warn(`[MQTranslationContext] Duplicate: ticket #${ticketId} already processing or queued`);
                return;
            }

            // 立即标记为已入队（同步操作，不受 React 批量更新影响）
            queuedTicketIdsRef.current.add(ticketId);

            const newTask: TranslationTask = {
                ticketId,
                externalId: data.externalId || `ID-${ticketId}`,
                subject: data.subject || 'Unknown Subject',
                status: 'pending',
                addedAt: Date.now()
            };

            console.log(`[MQTranslationContext] Task added to queue: ticket #${ticketId}`);
            setTranslationQueue(prev => [...prev, newTask]);
        });

        return () => {
            unlistenPromise.then(fn => fn());
        };
    }, []); // 空依赖 - 只注册一次

    // 处理单个任务（支持并发调用，每个任务独立运行）
    const processOneTask = useCallback(async (task: TranslationTask) => {
        console.log(`[MQTranslationContext] ▶ Processing ticket #${task.ticketId} (active: ${activeCountRef.current})`);

        // 标记为处理中
        setProcessingTasks(prev => {
            const next = new Map(prev);
            next.set(task.ticketId, { ...task, status: 'processing' });
            return next;
        });

        try {
            // 1. 获取最新详情
            console.log(`[MQTranslationContext] Fetching ticket detail #${task.ticketId}...`);
            const ticket = await serverApi.ticket.getTicketDetail(task.ticketId);
            if (!ticket) throw new Error(`Ticket #${task.ticketId} not found`);

            // 2. 执行翻译 (autoSave=true)
            console.log(`[MQTranslationContext] Starting translation for #${task.ticketId}...`);
            const success = await runTranslationRef.current(ticket, {
                autoSave: true,
                onStatusChange: (status) => console.log(`[MQTranslationContext] T#${task.ticketId} status: ${status}`)
            });

            if (!success) throw new Error('Translation function returned false');

            // 3. 通知后端完成
            console.log(`[MQTranslationContext] ✅ Translation completed for #${task.ticketId}`);
            await invoke('complete_translate_task', { ticketId: task.ticketId, success: true });

            // 4. 移动到历史
            setCompletedHistory(prev => [{ ...task, status: 'completed' as const }, ...prev].slice(0, 50));

        } catch (err: any) {
            console.error(`[MQTranslationContext] ❌ Failed ticket #${task.ticketId}:`, err);

            // 通知后端失败
            try {
                await invoke('complete_translate_task', { ticketId: task.ticketId, success: false });
            } catch (ackErr) {
                console.error(`[MQTranslationContext] Failed to send failure ack:`, ackErr);
            }

            setCompletedHistory(prev => [{
                ...task,
                status: 'failed' as const,
                error: err.message || String(err)
            }, ...prev].slice(0, 50));
        } finally {
            // 移除处理状态
            setProcessingTasks(prev => {
                const next = new Map(prev);
                next.delete(task.ticketId);
                return next;
            });
            queuedTicketIdsRef.current.delete(task.ticketId);
            activeCountRef.current--;
            console.log(`[MQTranslationContext] ■ Finished ticket #${task.ticketId} (active: ${activeCountRef.current})`);

            // 触发重新调度：如果队列中还有任务且有空闲槽位
            setTranslationQueue(prev => prev.length > 0 ? [...prev] : prev);
        }
    }, []);

    // 并发任务调度器 - 根据 batchSize 同时启动多个任务
    useEffect(() => {
        if (translationQueue.length === 0) return;

        const maxConcurrent = batchSizeRef.current;
        const slotsAvailable = maxConcurrent - activeCountRef.current;

        if (slotsAvailable <= 0) return;

        const count = Math.min(slotsAvailable, translationQueue.length);
        const tasksToStart = translationQueue.slice(0, count);

        // 从队列中移除即将启动的任务
        setTranslationQueue(prev => prev.slice(count));

        // 并发启动任务（不 await，各自独立运行）
        console.log(`[MQTranslationContext] 🚀 Dispatching ${count} tasks (slots: ${slotsAvailable}, queue: ${translationQueue.length})`);
        for (const task of tasksToStart) {
            activeCountRef.current++;
            processOneTask(task);
        }
    }, [translationQueue, batchSize, processOneTask]);

    const clearHistory = useCallback(() => {
        setCompletedHistory([]);
    }, []);

    return (
        <MQTranslationContext.Provider value={{
            translationQueue,
            processingTasks,
            completedHistory,
            clearHistory,
            isRunning,
            startConsumer,
            stopConsumer,
            batchSize,
            updateBatchSize,
            logs
        }}>
            {children}
        </MQTranslationContext.Provider>
    );
};

export const useMQTranslation = () => {
    const context = useContext(MQTranslationContext);
    if (!context) throw new Error('useMQTranslation must be used within MQTranslationProvider');
    return context;
};
