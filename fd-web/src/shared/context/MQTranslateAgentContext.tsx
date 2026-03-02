import React, { ReactNode, useCallback } from 'react';
import { createMQTaskContext, MQTask } from './createMQTaskContext';
import { AgentRegistry } from '../agents/AgentRegistry';

export type TranslateAgentTask = MQTask;

/**
 * 翻译 Agent MQ Context — 串行模式
 *
 * 消费 agent.ticket-translate 类型的任务（由 SyncAgentExecutionService 创建）。
 * 从任务 payload 中读取完整的 agentInput（包含 prompt、models 等），
 * 通过 CliExecutor 执行 Gemini CLI，将结果存储到 ticket._agentResult
 * 供 createMQTaskContext 的 completeTask 发送回服务端。
 */
const { Provider: BaseProvider, useTaskContext } = createMQTaskContext({
    taskType: 'agent.ticket-translate',
    defaultBatchSize: 1,
    concurrencyMode: 'serial',
    pollIntervalMs: 3000,
});

export const MQTranslateAgentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const taskProcessor = useCallback(async (ticket: any) => {
        const agentInput = ticket._agentInput || {};
        const agentCode = ticket._agentCode || 'ticket-translate';

        console.log(`[MQTranslateAgent] Executing agent=${agentCode}, prompt length=${agentInput.prompt?.length || 0}`);

        const registry = AgentRegistry.getInstance();
        const resolved = registry.resolve(agentCode);

        if (!resolved) {
            throw new Error(`Agent "${agentCode}" not found in registry`);
        }

        // 合并 ticket 对象到 executor 输入，CliExecutor 需要 data.ticket 进入标准化路径
        const result = await resolved.executor.execute(resolved.definition, {
            data: { ...agentInput, ticket },
        });

        if (!result.success) {
            throw new Error(result.error || 'Translate Agent 执行失败');
        }

        // 将结果存储到 ticket._agentResult，completeTask 会读取并发送给服务端
        const output = typeof result.output === 'string'
            ? result.output
            : JSON.stringify(result.output);
        ticket._agentResult = output;

        console.log(`[MQTranslateAgent] Agent completed, output length=${output.length}`);
        return true;
    }, []);

    return <BaseProvider taskProcessor={taskProcessor}>{children}</BaseProvider>;
};

export const useMQTranslateAgent = () => {
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
