import React, { ReactNode, useCallback } from 'react';
import { createMQTaskContext, MQTask, TaskCallbacks } from './createMQTaskContext';
import { useAiTranslation } from '../hooks/useAiTranslation';
import { serverApi } from '../services/serverApi';

/** 向后兼容的类型别名 */
export type TranslationTask = MQTask;

/**
 * 检查已有翻译的 JSON 结构是否与原文匹配
 *
 * 比较 content 和 translatedContent 的 JSON 结构：
 * - 都有 description 字段（翻译后不为空）
 * - conversations 数组长度一致
 * - 每条 conversation 的 id 一一对应
 */
function isTranslationStructureMatch(content: string, translatedContent: string): boolean {
    try {
        const original = JSON.parse(content);
        const translated = JSON.parse(translatedContent);

        // 翻译必须有 description
        if (typeof translated.description !== 'string' || translated.description.trim() === '') {
            return false;
        }

        const origConvs: any[] = original.conversations || [];
        const transConvs: any[] = translated.conversations || [];

        // conversation 数量必须一致
        if (origConvs.length !== transConvs.length) return false;

        // 每条 conversation 的 id 必须一一对应
        for (let i = 0; i < origConvs.length; i++) {
            if (origConvs[i].id !== transConvs[i].id) return false;
        }

        return true;
    } catch {
        return false;
    }
}

/**
 * 翻译 MQ Context — 并发模式（batchSize=5）
 */
const { Provider: BaseProvider, useTaskContext } = createMQTaskContext({
    taskType: 'translate',
    eventName: 'mq-translate-request',
    startCommand: 'start_mq_consumer',
    stopCommand: 'stop_mq_consumer',
    statusCommand: 'get_mq_consumer_status',
    completeCommand: 'complete_translate_task',
    defaultBatchSize: 5,
    concurrencyMode: 'parallel',
});

export const MQTranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { runTranslation } = useAiTranslation();

    const taskProcessor = useCallback(async (ticket: any, callbacks: TaskCallbacks) => {
        // 检查是否已有完整翻译（JSON 结构匹配则跳过 Gemini 调用）
        if (ticket.translation?.translatedContent && ticket.content) {
            if (isTranslationStructureMatch(ticket.content, ticket.translation.translatedContent)) {
                const msg = `⏭ #${ticket.externalId} 已有完整翻译，跳过翻译直接完成`;
                console.log(`[MQ-translate] ${msg}`);
                callbacks.addLog?.(msg);

                // 重新提交已有翻译，确保状态流转一致（PENDING_TRANS → PENDING_REPLY + 发送回复任务）
                await serverApi.ticket.submitTranslation(ticket.id, {
                    targetLang: ticket.translation.targetLang,
                    translatedTitle: ticket.translation.translatedTitle,
                    translatedContent: ticket.translation.translatedContent,
                });
                return 'skipped' as const;
            }
        }

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
