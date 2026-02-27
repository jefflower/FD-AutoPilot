import React, { ReactNode, useCallback } from 'react';
import { createMQTaskContext, MQTask } from './createMQTaskContext';
import { useAiTranslation } from '../hooks/useAiTranslation';

/** 向后兼容的类型别名 */
export type TranslationTask = MQTask;

/**
 * 翻译 MQ Context — 串行模式（batchSize=1）
 * 并发度由工作流编排（多 Agent 节点）控制，消费端始终逐个处理
 */
const { Provider: BaseProvider, useTaskContext } = createMQTaskContext({
    taskType: 'ticket.translate',
    defaultBatchSize: 1,
    concurrencyMode: 'serial',
    pollIntervalMs: 3000,
});

export const MQTranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { runTranslation } = useAiTranslation();

    const taskProcessor = useCallback(async (ticket: any) => {
        return await runTranslation(ticket, { autoSave: true });
    }, [runTranslation]);

    return <BaseProvider taskProcessor={taskProcessor}>{children}</BaseProvider>;
};

export const useMQTranslation = () => {
    const ctx = useTaskContext();
    return {
        translationQueue: ctx.taskQueue,
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
