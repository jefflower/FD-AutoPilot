
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { serverApi } from '../services/serverApi';
import { useAiReply } from '../hooks/useAiReply';

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
}

const MQReplyContext = createContext<MQReplyContextType | null>(null);

export const MQReplyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [replyQueue, setReplyQueue] = useState<ReplyTask[]>([]);
    const [processingTasks, setProcessingTasks] = useState<Map<number, ReplyTask>>(new Map());
    const [completedHistory, setCompletedHistory] = useState<ReplyTask[]>([]);

    // Core Hook
    const { runReply } = useAiReply();

    // 监听 MQ 事件
    useEffect(() => {
        const unlistenPromise = listen<any>('mq-reply-request', (event) => {
            const data = event.payload;
            console.log('[MQReplyContext] Received request:', data);

            // 特殊处理 Reply: payload 可能是 JSON string
            let ticketId = data.ticketId;
            let externalId = data.externalId;
            let subject = data.subject;

            if (!ticketId && typeof data === 'string') {
                try {
                    const parsed = JSON.parse(data);
                    ticketId = parsed.ticketId;
                    externalId = parsed.externalId;
                    subject = parsed.subject;
                } catch (e) {
                    console.error('[MQReplyContext] Failed to parse payload', e);
                    return;
                }
            }

            if (!ticketId) {
                console.warn('[MQReplyContext] Invalid payload, no ticketId:', data);
                return;
            }

            // 检查去重
            if (processingTasks.has(ticketId) || replyQueue.some(t => t.ticketId === ticketId)) {
                console.warn(`[MQReplyContext] Duplicate task ignored for ticket #${ticketId}`);
                return;
            }

            const newTask: ReplyTask = {
                ticketId: ticketId,
                externalId: externalId || `ID-${ticketId}`,
                subject: subject || 'Unknown Subject',
                status: 'pending',
                addedAt: Date.now()
            };

            setReplyQueue(prev => [...prev, newTask]);
        });

        return () => {
            unlistenPromise.then(fn => fn());
        };
    }, [processingTasks, replyQueue]);

    // 任务处理循环
    useEffect(() => {
        const processNext = async () => {
            // 并发限制: Reply 比较重，严格限制为 1
            if (processingTasks.size >= 1 || replyQueue.length === 0) return;

            const [currentTask, ...remainingQueue] = replyQueue;
            setReplyQueue(remainingQueue);

            // 标记为处理中
            setProcessingTasks(prev => {
                const next = new Map(prev);
                next.set(currentTask.ticketId, { ...currentTask, status: 'processing' });
                return next;
            });

            try {
                console.log(`[MQReplyContext] Processing ticket #${currentTask.ticketId}`);

                // 1. 获取最新详情
                const ticket = await serverApi.ticket.getTicketDetail(currentTask.ticketId);
                if (!ticket) throw new Error(`Ticket #${currentTask.ticketId} not found`);

                // 2. 执行自动回复 (autoSave=true)
                // 注意：useAiReply 内部会检查 notebookConfig
                const success = await runReply(ticket, {
                    autoSave: true,
                    onStatusChange: (status) => console.log(`[MQReplyContext] T#${currentTask.ticketId} status: ${status}`),
                    onError: (err) => console.error(`[MQReplyContext] T#${currentTask.ticketId} error: ${err}`)
                });

                if (!success) throw new Error('Reply function returned false (check configurations?)');

                // 3. 通知后端完成
                await invoke('complete_reply_task', { ticketId: currentTask.ticketId, success: true });

                // 4. 移动到历史
                setCompletedHistory(prev => [{ ...currentTask, status: 'completed' }, ...prev].slice(0, 50));

            } catch (err: any) {
                console.error(`[MQReplyContext] Failed ticket #${currentTask.ticketId}:`, err);

                // 通知后端失败
                await invoke('complete_reply_task', { ticketId: currentTask.ticketId, success: false });

                setCompletedHistory(prev => [{
                    ...currentTask,
                    status: 'failed',
                    error: err.message || String(err)
                }, ...prev].slice(0, 50));
            } finally {
                // 移除处理状态
                setProcessingTasks(prev => {
                    const next = new Map(prev);
                    next.delete(currentTask.ticketId);
                    return next;
                });
            }
        };

        processNext();
    }, [replyQueue, processingTasks, runReply]);

    const clearHistory = useCallback(() => {
        setCompletedHistory([]);
    }, []);

    return (
        <MQReplyContext.Provider value={{ replyQueue, processingTasks, completedHistory, clearHistory }}>
            {children}
        </MQReplyContext.Provider>
    );
};

export const useMQReply = () => {
    const context = useContext(MQReplyContext);
    if (!context) throw new Error('useMQReply must be used within MQReplyProvider');
    return context;
};
