import React, { ReactNode, useCallback } from 'react';
import { createMQTaskContext, MQTask } from './createMQTaskContext';
import { AgentRegistry } from '../agents/AgentRegistry';

export type ReplyAgentTask = MQTask;

/**
 * 回复 Agent MQ Context — 串行模式
 *
 * 消费 agent.ticket-reply 类型的任务（由 SyncAgentExecutionService 创建）。
 * 将完整 ticket 对象传入 NotebookLmPyExecutor，Executor 自行读取 AgentDefinition
 * 中配置的 systemPrompt 和 notebookId，模板展开 ${TICKET_CONTENT} 后发送给 NotebookLM。
 * 外部只需传入标准化工单数据 { ticket: { id, subject, content }, lastAuditRemark? }。
 */
const { Provider: BaseProvider, useTaskContext } = createMQTaskContext({
    taskType: 'agent.ticket-reply',
    defaultBatchSize: 1,
    concurrencyMode: 'serial',
    pollIntervalMs: 3000,
});

export const MQReplyAgentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const taskProcessor = useCallback(async (ticket: any) => {
        const agentInput = ticket._agentInput || {};
        const agentCode = ticket._agentCode || 'ticket-reply';

        console.log(`[MQReplyAgent] Executing agent=${agentCode}, ticketId=${ticket.id}, hasAgentInput=${!!ticket._agentInput}`);

        const registry = AgentRegistry.getInstance();
        const resolved = registry.resolve(agentCode);

        if (!resolved) {
            throw new Error(`Agent "${agentCode}" not found in registry`);
        }

        // 合并 ticket 对象到 executor 输入，executor 需要 data.ticket 构建标准化参数
        const result = await resolved.executor.execute(resolved.definition, {
            data: { ...agentInput, ticket },
        });

        if (!result.success) {
            throw new Error(result.error || 'Reply Agent 执行失败');
        }

        // 将结果存储到 ticket._agentResult，completeTask 会读取并发送给服务端
        const output = typeof result.output === 'string'
            ? result.output
            : JSON.stringify(result.output);
        ticket._agentResult = output;

        console.log(`[MQReplyAgent] Agent completed, output length=${output.length}`);
        return true;
    }, []);

    return <BaseProvider taskProcessor={taskProcessor}>{children}</BaseProvider>;
};

export const useMQReplyAgent = () => {
    const ctx = useTaskContext();
    return {
        taskQueue: ctx.taskQueue,
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
