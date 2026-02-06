import { useCallback } from 'react';
import { useSettings } from './useSettings';
import { useTicketProcess } from './useTicketProcess';
import { useTicketProcess } from './useTicketProcess';
import { NotebookShadowService } from '../services/notebookShadow';
import { serverApi } from '../services/serverApi';

interface AiReplyOptions {
    onStatusChange?: (status: 'replying' | null) => void;
    onError?: (error: string) => void;
    autoSave?: boolean;
}

export function useAiReply() {
    const { notebookLMConfig: notebookConfig } = useSettings();
    const { setProcessStatus, setActiveReplyingId, setTempAiReply } = useTicketProcess();

    // 员工 ID 映射配置表 (Shared logic)
    const AGENT_MAP: Record<string, string> = {
        "158001343601": "Simsonn1",
        "158000445778": "Simsonn2",
        "158007774607": "Simsonn3",
    };

    const runReply = useCallback(async (ticket: any, options: AiReplyOptions = {}) => {
        const { onStatusChange, onError, autoSave } = options;
        
        console.log(`[useAiReply] Starting reply generation for ticket #${ticket.id}, autoSave=${autoSave}`);
        setProcessStatus(ticket.id, 'replying');
        if (onStatusChange) onStatusChange('replying');

        // NotebookLM Config Check
        if (!notebookConfig?.notebookId) {
            const err = '请先在“设置”中配置 Notebook ID';
            if (onError) onError(err);
            if (!autoSave) alert(err);
            setProcessStatus(ticket.id, null);
            if (onStatusChange) onStatusChange(null);
            return false;
        }

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
                
                // 简单的解析逻辑复用
                if (chunk.status === 'complete' || (chunk.text.includes('[') && chunk.text.includes(']'))) {
                     try {
                        let textToParse = chunk.text.trim();
                        const startIdx = textToParse.indexOf('[');
                        const endIdx = textToParse.lastIndexOf(']');
                        if (startIdx !== -1 && endIdx > startIdx) {
                            textToParse = textToParse.substring(startIdx, endIdx + 1);
                        }

                        let parsed = null;
                        try {
                            parsed = JSON.parse(textToParse);
                        } catch {
                            const match = textToParse.match(/^\[\s*"([\s\S]*?)"\s*,\s*"([\s\S]*?)"\s*\]$/);
                            if (match) {
                                const str1 = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                                const str2 = match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                                parsed = [str1, str2];
                            }
                        }

                        if (parsed && Array.isArray(parsed) && parsed.length >= 2) {
                            finalParsed = [parsed[0], parsed[1]];
                            
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
            if (onError) onError(errMsg);
            return false;
        } finally {
            console.log(`[useAiReply] Finished for #${ticket.id}`);
            setActiveReplyingId(null);
            setProcessStatus(ticket.id, null);
            if (onStatusChange) onStatusChange(null);
        }
    }, [notebookConfig, setActiveReplyingId, setProcessStatus, setTempAiReply]);

    return { runReply };
}
