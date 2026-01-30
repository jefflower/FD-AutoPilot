import React, { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { NotebookShadowService } from '../services/notebookShadow';
import { serverApi } from '../services/serverApi';
import { NotebookLMConfig } from '../types';

interface MQTaskRunnerProps {
    notebookLMConfig: NotebookLMConfig;
    setLogs: (updater: (prev: string[]) => string[]) => void;
}

interface MQReplyRequest {
    ticketId: number;
    externalId: string;
    subject: string;
    description: string | null;
    conversations: any[];
    authToken: string;
}

const MQTaskRunner: React.FC<MQTaskRunnerProps> = ({ notebookLMConfig, setLogs }) => {
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        const unlistenPromise = listen<string>('mq-reply-request', async (event) => {
            console.log('[MQTaskRunner] Received request:', event.payload);

            if (isProcessing) {
                console.warn('[MQTaskRunner] Already processing a task, skipping (MQ prefetch should be 1)');
                return;
            }

            if (!notebookLMConfig.notebookId) {
                setLogs(prev => [...prev, '❌ MQ Task Error: Notebook ID not configured']);
                return;
            }

            let ticketId: number | null = null;
            try {
                const request: MQReplyRequest = JSON.parse(event.payload);
                ticketId = request.ticketId;
                setIsProcessing(true);
                setLogs(prev => [...prev, `🤖 MQ Task: Generating reply for ticket #${request.ticketId} via NotebookLM`]);

                // ... (rest of the logic)
                let context = `Subject: ${request.subject}\n\nDescription: ${request.description || 'No description'}\n\n`;
                if (request.conversations && request.conversations.length > 0) {
                    context += "Conversations history:\n";
                    for (const conv of request.conversations) {
                        // 兼容 snake_case (MQ传来的) 和 camelCase
                        const body = conv.bodyText || conv.body_text || '';
                        context += `${conv.incoming ? 'Customer' : 'Agent'}: ${body}\n`;
                    }
                }

                const finalPrompt = (notebookLMConfig.prompt || '请根据以下工单内容回答我的问题:\n\n${工单内容}').replace('${工单内容}', context);
                const shadowService = new NotebookShadowService(notebookLMConfig.notebookId);

                // 确保窗口可见且活跃，避免部分浏览器策略拦截脚本执行
                console.log('[MQTaskRunner] Opening shadow window...');
                await shadowService.show();
                setLogs(prev => [...prev, `🌐 MQ Task: Shadow window opened for ticket #${request.ticketId}`]);

                let finalReply = '';
                for await (const chunk of shadowService.query(finalPrompt)) {
                    if (chunk.status === 'error') throw new Error(chunk.text);
                    finalReply = chunk.text;
                }

                if (!finalReply) throw new Error('AI generated an empty reply');

                let zhReply = '';
                let targetReply = '';
                try {
                    let textToParse = finalReply.trim();
                    const startIdx = textToParse.indexOf('[');
                    const endIdx = textToParse.lastIndexOf(']');
                    if (startIdx !== -1 && endIdx > startIdx) {
                        textToParse = textToParse.substring(startIdx, endIdx + 1);
                    }
                    const parsed = JSON.parse(textToParse);
                    if (Array.isArray(parsed) && parsed.length >= 2) {
                        targetReply = parsed[0];
                        zhReply = parsed[1];
                    } else {
                        targetReply = finalReply;
                        zhReply = '(No Chinese version parsed)';
                    }
                } catch {
                    targetReply = finalReply;
                    zhReply = '(Parse failed, showing raw content)';
                }

                await serverApi.ticket.submitReply(request.ticketId, {
                    zhReply,
                    targetReply
                }, request.authToken);

                setLogs(prev => [...prev, `✅ MQ Task: Reply for #${request.ticketId} submitted successfully.`]);
                await invoke('complete_reply_task', { ticketId, success: true });
            } catch (err: any) {
                console.error('[MQTaskRunner] Error:', err);
                setLogs(prev => [...prev, `❌ MQ Task Error: ${err.message || String(err)}`]);
                if (ticketId) {
                    await invoke('complete_reply_task', { ticketId, success: false });
                }
            } finally {
                setIsProcessing(false);
            }
        });

        return () => {
            unlistenPromise.then(fn => fn());
        };
    }, [notebookLMConfig, isProcessing, setLogs]);

    return null; // 全局隐藏组件
};

export default MQTaskRunner;
