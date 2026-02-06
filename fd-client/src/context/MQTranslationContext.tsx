
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
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
}

const MQTranslationContext = createContext<MQTranslationContextType | null>(null);

export const MQTranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [translationQueue, setTranslationQueue] = useState<TranslationTask[]>([]);
    const [processingTasks, setProcessingTasks] = useState<Map<number, TranslationTask>>(new Map());
    const [completedHistory, setCompletedHistory] = useState<TranslationTask[]>([]);

    // Core Hook
    const { runTranslation } = useAiTranslation();

    // 监听 MQ 事件
    useEffect(() => {
        const unlistenPromise = listen<any>('mq-translate-request', (event) => {
            const data = event.payload;
            console.log('[MQTranslationContext] Received request:', data);

            // 检查去重 (队列中或正在处理中)
            if (processingTasks.has(data.ticketId) || translationQueue.some(t => t.ticketId === data.ticketId)) {
                console.warn(`[MQTranslationContext] Duplicate task ignored for ticket #${data.ticketId}`);
                return;
            }

            const newTask: TranslationTask = {
                ticketId: data.ticketId,
                externalId: data.externalId || `ID-${data.ticketId}`,
                subject: data.subject || 'Unknown Subject',
                status: 'pending',
                addedAt: Date.now()
            };

            setTranslationQueue(prev => [...prev, newTask]);
        });

        return () => {
            unlistenPromise.then(fn => fn());
        };
    }, [processingTasks, translationQueue]);

    // 任务处理循环
    useEffect(() => {
        const processNext = async () => {
            // 并发限制: 暂时设为 1，确保稳定性
            if (processingTasks.size >= 1 || translationQueue.length === 0) return;

            const [currentTask, ...remainingQueue] = translationQueue;
            setTranslationQueue(remainingQueue);

            // 标记为处理中
            setProcessingTasks(prev => {
                const next = new Map(prev);
                next.set(currentTask.ticketId, { ...currentTask, status: 'processing' });
                return next;
            });

            try {
                console.log(`[MQTranslationContext] Processing ticket #${currentTask.ticketId}`);

                // 1. 获取最新详情
                const ticket = await serverApi.ticket.getTicketDetail(currentTask.ticketId);
                if (!ticket) throw new Error(`Ticket #${currentTask.ticketId} not found`);

                // 2. 执行翻译 (autoSave=true)
                const success = await runTranslation(ticket, {
                    autoSave: true,
                    onStatusChange: (status) => console.log(`[MQTranslationContext] T#${currentTask.ticketId} status: ${status}`)
                });

                if (!success) throw new Error('Translation function returned false');

                // 3. 通知后端完成
                await invoke('complete_translate_task', { ticketId: currentTask.ticketId, success: true });

                // 4. 移动到历史
                setCompletedHistory(prev => [{ ...currentTask, status: 'completed' }, ...prev].slice(0, 50));

            } catch (err: any) {
                console.error(`[MQTranslationContext] Failed ticket #${currentTask.ticketId}:`, err);

                // 通知后端失败
                await invoke('complete_translate_task', { ticketId: currentTask.ticketId, success: false });

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
    }, [translationQueue, processingTasks, runTranslation]);

    const clearHistory = useCallback(() => {
        setCompletedHistory([]);
    }, []);

    return (
        <MQTranslationContext.Provider value={{ translationQueue, processingTasks, completedHistory, clearHistory }}>
            {children}
        </MQTranslationContext.Provider>
    );
};

export const useMQTranslation = () => {
    const context = useContext(MQTranslationContext);
    if (!context) throw new Error('useMQTranslation must be used within MQTranslationProvider');
    return context;
};
