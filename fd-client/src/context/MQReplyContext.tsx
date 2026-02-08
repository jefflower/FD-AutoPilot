
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { serverApi } from '../services/serverApi';
import { useAiReply } from '../hooks/useAiReply';
import { useTicketProcess } from '../hooks/useTicketProcess';

export interface ReplyTask {
    ticketId: number;
    externalId: string;
    subject: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
    addedAt: number;
}

interface MQReplyContextType {
    replyQueue: ReplyTask[];
    processingTasks: Map<number, ReplyTask>;
    completedHistory: ReplyTask[];
    clearHistory: () => void;
    // Control & Status
    isRunning: boolean;
    startConsumer: () => void;
    stopConsumer: () => void;
    batchSize: number;
    updateBatchSize: (size: number) => void;
    logs: string[];
}

const MQReplyContext = createContext<MQReplyContextType | null>(null);

export const MQReplyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [replyQueue, setReplyQueue] = useState<ReplyTask[]>([]);
    const [processingTasks, setProcessingTasks] = useState<Map<number, ReplyTask>>(new Map());
    const [completedHistory, setCompletedHistory] = useState<ReplyTask[]>([]);

    const [isRunning, setIsRunning] = useState(false);
    const [batchSize, setBatchSize] = useState(1);
    const [logs, setLogs] = useState<string[]>([]);

    // Core Hooks
    const { runReply } = useAiReply();
    const { setStreamingText } = useTicketProcess();

    // Refs: 避免闭包陈旧问题
    const processingTasksRef = useRef(processingTasks);
    const replyQueueRef = useRef(replyQueue);
    const isProcessingRef = useRef(false);
    const runReplyRef = useRef(runReply);
    const setStreamingTextRef = useRef(setStreamingText);
    const queuedTicketIdsRef = useRef(new Set<number>()); // 同步去重，防止 React 批量更新导致重复入队

    // 同步 refs
    useEffect(() => { processingTasksRef.current = processingTasks; }, [processingTasks]);
    useEffect(() => { replyQueueRef.current = replyQueue; }, [replyQueue]);
    useEffect(() => { runReplyRef.current = runReply; }, [runReply]);
    useEffect(() => { setStreamingTextRef.current = setStreamingText; }, [setStreamingText]);

    // 轮询 Reply MQ 消费者状态
    const checkStatus = useCallback(async () => {
        try {
            const status = await invoke<{ isRunning: boolean; batchSize: number }>('get_reply_mq_consumer_status');
            setIsRunning(status.isRunning);
            setBatchSize(status.batchSize);
        } catch (err) {
            console.error('[MQReplyContext] Failed to get MQ status:', err);
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
        import('@tauri-apps/api/event').then(({ listen }) => {
            listen<string>('log', (event) => {
                setLogs(prev => [...prev.slice(-49), event.payload]);
            }).then((fn) => {
                unlisten = fn;
            });
        });
        return () => { if (unlisten) unlisten(); };
    }, []);

    const startConsumer = useCallback(async () => {
        try {
            const authToken = localStorage.getItem('fd_auth_token') || '';
            await invoke('start_reply_mq_consumer', { authToken });
            setLogs(prev => [...prev, '🐰 Reply MQ 消费启动中...']);
            // 不立即设置 isRunning=true，实际连接在 tokio::spawn 中异步执行
            // 延迟检查真实状态
            setTimeout(() => checkStatus(), 1500);
        } catch (err: any) {
            setLogs(prev => [...prev, `❌ 启动失败: ${err.message}`]);
        }
    }, [checkStatus]);

    const stopConsumer = useCallback(async () => {
        try {
            await invoke('stop_reply_mq_consumer');
            setLogs(prev => [...prev, '🛑 Reply MQ 消费已停止']);
            setIsRunning(false);
        } catch (err: any) {
            setLogs(prev => [...prev, `❌ 停止失败: ${err.message}`]);
        }
    }, []);

    const updateBatchSize = useCallback(async (size: number) => {
        try {
            await invoke('update_mq_batch_size', { batchSize: size });
            setBatchSize(size);
        } catch (err) {
            console.error(err);
        }
    }, []);

    // 监听 MQ 事件 - 空依赖，只注册一次，使用 ref 做去重
    useEffect(() => {
        const unlistenPromise = listen<any>('mq-reply-request', (event) => {
            const raw = event.payload;
            console.log('[MQReplyContext] Received mq-reply-request:', raw);

            // 兼容 string 和 object 两种载荷格式
            let data: any;
            if (typeof raw === 'string') {
                try {
                    data = JSON.parse(raw);
                } catch (e) {
                    console.error('[MQReplyContext] Failed to parse payload string:', e);
                    return;
                }
            } else {
                data = raw;
            }

            const ticketId = data.ticketId;
            const externalId = data.externalId;
            const subject = data.subject;

            if (!ticketId) {
                console.warn('[MQReplyContext] Invalid payload, no ticketId:', data);
                return;
            }

            // 同步 ref 去重（防止 React 批量更新期间事件回调连续触发导致重复入队）
            if (processingTasksRef.current.has(ticketId) || queuedTicketIdsRef.current.has(ticketId)) {
                console.warn(`[MQReplyContext] Duplicate: ticket #${ticketId} already processing or queued`);
                return;
            }

            // 立即标记为已入队（同步操作，不受 React 批量更新影响）
            queuedTicketIdsRef.current.add(ticketId);

            const newTask: ReplyTask = {
                ticketId,
                externalId: externalId || `ID-${ticketId}`,
                subject: subject || 'Unknown Subject',
                status: 'pending',
                addedAt: Date.now()
            };

            console.log(`[MQReplyContext] Task added to queue: ticket #${ticketId}`);
            setReplyQueue(prev => [...prev, newTask]);
        });

        return () => {
            unlistenPromise.then(fn => fn());
        };
    }, []); // 空依赖 - 只注册一次

    // 任务处理循环 - 使用 isProcessingRef 防止并发
    useEffect(() => {
        if (isProcessingRef.current || replyQueue.length === 0) return;

        const processNext = async () => {
            isProcessingRef.current = true;

            const currentTask = replyQueue[0];
            if (!currentTask) {
                isProcessingRef.current = false;
                return;
            }
            setReplyQueue(prev => prev.slice(1));

            console.log(`[MQReplyContext] ▶ Processing ticket #${currentTask.ticketId}`);

            // 标记为处理中
            setProcessingTasks(prev => {
                const next = new Map(prev);
                next.set(currentTask.ticketId, { ...currentTask, status: 'processing' });
                return next;
            });

            try {
                // 1. 获取最新详情
                console.log(`[MQReplyContext] Fetching ticket detail #${currentTask.ticketId}...`);
                const ticket = await serverApi.ticket.getTicketDetail(currentTask.ticketId);
                if (!ticket) throw new Error(`Ticket #${currentTask.ticketId} not found`);

                // 2. 执行自动回复 (autoSave=true)
                console.log(`[MQReplyContext] Starting runReply for #${currentTask.ticketId}...`);
                const success = await runReplyRef.current(ticket, {
                    autoSave: true,
                    onStatusChange: (status) => console.log(`[MQReplyContext] T#${currentTask.ticketId} status: ${status}`),
                    onError: (err) => console.error(`[MQReplyContext] T#${currentTask.ticketId} error: ${err}`),
                    onStreamChunk: (text) => setStreamingTextRef.current(currentTask.ticketId, text),
                });

                if (!success) throw new Error('Reply function returned false (check configurations?)');

                // 3. 通知后端完成
                console.log(`[MQReplyContext] ✅ Reply completed for #${currentTask.ticketId}, notifying backend...`);
                await invoke('complete_reply_task', { ticketId: currentTask.ticketId, success: true });

                // 4. 移动到历史
                setCompletedHistory(prev => [{ ...currentTask, status: 'completed' as const }, ...prev].slice(0, 50));

            } catch (err: any) {
                console.error(`[MQReplyContext] ❌ Failed ticket #${currentTask.ticketId}:`, err);

                try {
                    await invoke('complete_reply_task', { ticketId: currentTask.ticketId, success: false });
                } catch (ackErr) {
                    console.error(`[MQReplyContext] Failed to send failure ack:`, ackErr);
                }

                setCompletedHistory(prev => [{
                    ...currentTask,
                    status: 'failed' as const,
                    error: err.message || String(err)
                }, ...prev].slice(0, 50));
            } finally {
                // 移除处理状态
                setProcessingTasks(prev => {
                    const next = new Map(prev);
                    next.delete(currentTask.ticketId);
                    return next;
                });
                queuedTicketIdsRef.current.delete(currentTask.ticketId);
                isProcessingRef.current = false;
                console.log(`[MQReplyContext] ■ Finished processing ticket #${currentTask.ticketId}`);

                // 任务间延迟 1 秒，确保 Shadow Window 有时间稳定
                await new Promise(r => setTimeout(r, 1000));

                // 强制 re-trigger: 如果队列中还有任务，创建新的数组引用触发 useEffect
                setReplyQueue(prev => prev.length > 0 ? [...prev] : prev);
            }
        };

        processNext();
    }, [replyQueue]);

    const clearHistory = useCallback(() => {
        setCompletedHistory([]);
    }, []);

    return (
        <MQReplyContext.Provider value={{
            replyQueue,
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
        </MQReplyContext.Provider>
    );
};

export const useMQReply = () => {
    const context = useContext(MQReplyContext);
    if (!context) throw new Error('useMQReply must be used within MQReplyProvider');
    return context;
};
