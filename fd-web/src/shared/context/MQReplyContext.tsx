import React, { ReactNode, useCallback } from 'react';
import { createMQTaskContext, MQTask, TaskCallbacks } from './createMQTaskContext';
import { useAiReply } from '../hooks/useAiReply';
import { useTicketProcess } from '../hooks/useTicketProcess';
import { serverApi } from '../services/serverApi';
import { AGENT_MAP } from '../constants/agentMap';

/** 向后兼容的类型别名 */
export type ReplyTask = MQTask;

/**
 * 判断最后一条对话是否来自客户
 *
 * 解析 ticket.content JSON，取 conversations 数组最后一条：
 * - incoming === true 且 userId 不在 AGENT_MAP 中 → 客户消息
 * - 否则 → 客服/Agent 消息
 */
function isLastConversationFromCustomer(content: string): boolean {
    try {
        const parsed = JSON.parse(content);
        const conversations: any[] = parsed.conversations || [];
        if (conversations.length === 0) return true; // 无对话记录，按需回复

        const last = conversations[conversations.length - 1];
        const isAgent = AGENT_MAP[String(last.userId)];
        return last.incoming !== false && !isAgent;
    } catch {
        return true; // 解析失败，不跳过
    }
}

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

    const taskProcessor = useCallback(async (ticket: any, callbacks: TaskCallbacks) => {
        // MQ 自动回复模式：最后一条对话不是客户消息时，跳过回复并标记完成
        if (ticket.content && !isLastConversationFromCustomer(ticket.content)) {
            const msg = `⏭ #${ticket.externalId} 最后对话非客户消息，跳过回复`;
            console.log(`[MQ-reply] ${msg}`);
            callbacks.addLog?.(msg);

            // 调用服务端接口：直接标记为 COMPLETED，跳过审核
            await serverApi.ticket.skipReply(ticket.id);
            return 'skipped' as const;
        }

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
