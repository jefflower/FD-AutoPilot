import { useCallback } from 'react';
import { useSettings } from './useSettings';
import { useTicketProcess } from './useTicketProcess';
import { serverApi } from '../services/serverApi';
import { getReplyProvider } from '../ai';

interface AiReplyOptions {
    onStatusChange?: (status: 'replying' | null) => void;
    onError?: (error: string) => void;
    onStreamChunk?: (text: string) => void;
    onParsed?: (replies: [string, string]) => void;
    onPromptReady?: (prompt: string) => void;
    autoSave?: boolean;
}

export function useAiReply() {
    const { notebookLMConfig: notebookConfig } = useSettings();
    const { setProcessStatus, setActiveReplyingId, setTempAiReply, getActiveReplyingId } = useTicketProcess();

    const runReply = useCallback(async (ticket: any, options: AiReplyOptions = {}) => {
        const { onStatusChange, onError, onStreamChunk, onParsed, onPromptReady, autoSave } = options;

        console.log(`[useAiReply] Starting reply generation for ticket #${ticket.id}, autoSave=${autoSave}`);

        // 配置检查
        if (!notebookConfig?.notebookId) {
            const err = '请先在"设置"中配置 Notebook ID';
            onError?.(err);
            return false;
        }

        // 互斥检查
        const currentActiveId = getActiveReplyingId();
        if (currentActiveId !== null && currentActiveId !== ticket.id) {
            const err = `工单 #${currentActiveId} 正在执行 AI Reply，请等待完成后再试。`;
            onError?.(err);
            return false;
        }

        setProcessStatus(ticket.id, 'replying');
        onStatusChange?.('replying');
        setActiveReplyingId(ticket.id);

        try {
            const provider = getReplyProvider('notebooklm', {
                notebookId: notebookConfig.notebookId,
                notebookUrl: notebookConfig.notebookUrl
            });

            const promptTemplate = notebookConfig.prompt || '请根据以下工单内容回答我的问题:\n\n${工单内容}';
            onPromptReady?.(promptTemplate);

            console.log(`[useAiReply] Using provider: ${provider.name}`);

            let saveSuccess = false;
            let saveError: Error | null = null;
            let finalParsed: [string, string] | null = null;

            // 流式处理
            for await (const chunk of provider.generateReply({ ticket, promptTemplate })) {
                if (chunk.status === 'error') {
                    throw new Error(chunk.text);
                }

                onStreamChunk?.(chunk.text);

                // 尝试解析回复
                if (chunk.status === 'complete' || (chunk.text.includes('[') && chunk.text.includes(']'))) {
                    const parsed = provider.parseReply(chunk.text);

                    if (parsed) {
                        finalParsed = parsed;
                        onParsed?.(finalParsed);

                        if (autoSave) {
                            try {
                                await serverApi.ticket.submitReply(ticket.id, {
                                    zhReply: parsed[1],
                                    targetReply: parsed[0]
                                });
                                saveSuccess = true;
                                break;
                            } catch (err) {
                                console.error('Auto-save reply failed:', err);
                                saveError = err as Error;
                                break;
                            }
                        } else {
                            setTempAiReply(ticket.id, parsed);
                        }
                    }
                }
            }

            if (autoSave) {
                if (saveError) throw saveError;
                return saveSuccess;
            }

            return !!finalParsed;

        } catch (e) {
            console.error('[useAiReply] Error:', e);
            const errMsg = (e as Error).message || String(e);
            onError?.(errMsg);
            return false;
        } finally {
            setActiveReplyingId(null);
            setProcessStatus(ticket.id, null);
            onStatusChange?.(null);
        }
    }, [notebookConfig, setActiveReplyingId, setProcessStatus, setTempAiReply, getActiveReplyingId]);

    return { runReply };
}
