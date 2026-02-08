import { useCallback } from 'react';
import { useSettings } from './useSettings';
import { useTicketProcess } from './useTicketProcess';
import { NotebookShadowService } from '../services/notebookShadow';
import { serverApi } from '../services/serverApi';
import { AGENT_MAP } from '../constants/agentMap';

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

        // NotebookLM Config Check
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
            // 解析内容并构建 Context
            let parsedData: any = {};
            try {
                parsedData = JSON.parse(ticket.content || '{}');
            } catch (e) { }

            let context = `【TICKET SUBJECT】: ${ticket.subject}\n`;
            context += `【INITIAL DESCRIPTION】: ${parsedData?.description || 'No description content'}\n\n`;

            if (parsedData?.conversations && parsedData.conversations.length > 0) {
                context += "【DETAILED INTERACTION LOGS】:\n";
                context += "--------------------------------------------------\n";
                for (const conv of parsedData.conversations) {
                    const userIdStr = String(conv.userId);
                    const agentName = AGENT_MAP[userIdStr];
                    const role = agentName ? `AGENT (${agentName})` : (conv.incoming ? 'CUSTOMER' : 'AGENT');

                    const timeStr = conv.createdAt || 'Unknown Time';
                    context += `[${timeStr}] <${role}>:\n${conv.bodyText}\n`;
                    context += "--------------------------------------------------\n";
                }
            }

            const promptTemplate = notebookConfig.prompt || '请根据以下工单内容回答我的问题:\n\n${工单内容}';
            const finalPrompt = promptTemplate.replace('${工单内容}', context);

            onPromptReady?.(finalPrompt);
            console.log('[useAiReply] Context prepared, initialising Shadow Service...');

            const shadowService = new NotebookShadowService(notebookConfig.notebookId, notebookConfig.notebookUrl);
            let saveSuccess = false;
            let saveError: Error | null = null;
            let finalParsed: [string, string] | null = null;

            // Stream processing
            for await (const chunk of shadowService.query(finalPrompt)) {
                if (chunk.status === 'error') {
                    throw new Error(chunk.text);
                }

                // 回调流式文本
                onStreamChunk?.(chunk.text);

                // 解析逻辑
                if (chunk.status === 'complete' || (chunk.text.includes('[') && chunk.text.includes(']'))) {
                    try {
                        let textToParse = chunk.text.trim();

                        // 智能 JSON 数组提取：
                        // 不用 indexOf('[')（会匹配到 prompt 中的 [timestamp]），
                        // 而是从后往前搜索 [" 或 [\n" 模式（JSON 字符串数组的特征）
                        let jsonStr: string | null = null;
                        const lastBracket = textToParse.lastIndexOf(']');
                        if (lastBracket !== -1) {
                            // 从 lastBracket 往前搜索每一个 [，尝试解析
                            for (let i = lastBracket - 1; i >= 0; i--) {
                                if (textToParse[i] === '[') {
                                    const candidate = textToParse.substring(i, lastBracket + 1);
                                    // 快速预检：[ 后面应紧跟空白或 "
                                    const afterBracket = candidate.substring(1).trimStart();
                                    if (!afterBracket.startsWith('"')) continue;
                                    try {
                                        const test = JSON.parse(candidate);
                                        if (Array.isArray(test) && test.length >= 2 && typeof test[0] === 'string') {
                                            jsonStr = candidate;
                                            break;
                                        }
                                    } catch {
                                        // 继续往前搜索
                                    }
                                }
                            }
                        }

                        if (jsonStr) {
                            textToParse = jsonStr;
                        } else {
                            // fallback: 旧逻辑（简单的 indexOf/lastIndexOf）
                            const startIdx = textToParse.indexOf('[');
                            const endIdx = textToParse.lastIndexOf(']');
                            if (startIdx !== -1 && endIdx > startIdx) {
                                textToParse = textToParse.substring(startIdx, endIdx + 1);
                            }
                        }

                        let parsed = null;
                        try {
                            parsed = JSON.parse(textToParse);
                        } catch {
                            // 正则后备：匹配 ["str1", "str2"] 模式
                            const match = textToParse.match(/\[\s*"([\s\S]*?)"\s*,\s*"([\s\S]*?)"\s*\]/);
                            if (match) {
                                const str1 = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                                const str2 = match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                                parsed = [str1, str2];
                            }
                        }

                        if (parsed && Array.isArray(parsed) && parsed.length >= 2) {
                            finalParsed = [parsed[0], parsed[1]];
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
                                setTempAiReply(ticket.id, [parsed[0], parsed[1]]);
                            }
                        }
                    } catch (e) {
                        // ignore parse errors during stream
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
            console.log(`[useAiReply] Finished for #${ticket.id}`);
            setActiveReplyingId(null);
            setProcessStatus(ticket.id, null);
            onStatusChange?.(null);
        }
    }, [notebookConfig, setActiveReplyingId, setProcessStatus, setTempAiReply, getActiveReplyingId]);

    return { runReply };
}
