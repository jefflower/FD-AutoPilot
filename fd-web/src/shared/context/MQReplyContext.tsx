import React, { ReactNode, useCallback } from 'react';
import { createMQTaskContext, MQTask } from './createMQTaskContext';
import { useAiReply } from '../hooks/useAiReply';
import { useTicketProcess } from '../hooks/useTicketProcess';

/** 向后兼容的类型别名 */
export type ReplyTask = MQTask;

/**
 * 回复 MQ Context — 串行模式（batchSize=1，任务间延迟 1s）
 */
const { Provider: BaseProvider, useTaskContext } = createMQTaskContext({
    taskType: 'ticket.reply',
    defaultBatchSize: 1,
    concurrencyMode: 'serial',
    interTaskDelayMs: 1000,
    pollIntervalMs: 3000,
});

export const MQReplyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { runReply } = useAiReply();
    const { setStreamingText } = useTicketProcess();

    const taskProcessor = useCallback(async (ticket: any) => {
        return await runReply(ticket, {
            autoSave: true,
            onStreamChunk: (text) => setStreamingText(ticket.id, text),
        });
    }, [runReply, setStreamingText]);

    return <BaseProvider taskProcessor={taskProcessor}>{children}</BaseProvider>;
};

export const useMQReply = () => {
    const ctx = useTaskContext();
    return {
        replyQueue: ctx.taskQueue,
        processingTasks: ctx.processingTasks,
        completedHistory: ctx.completedHistory,
        clearHistory: ctx.clearHistory,
        isRunning: ctx.isRunning,
        startConsumer: ctx.startConsumer,
        stopConsumer: ctx.stopConsumer,
        batchSize: ctx.batchSize,
        updateBatchSize: ctx.updateBatchSize,
        logs: ctx.logs,
    };
};
