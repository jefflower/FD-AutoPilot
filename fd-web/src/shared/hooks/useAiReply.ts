import { useCallback } from 'react';
import { useTicketProcess } from './useTicketProcess';
import { serverApi } from '../services/serverApi';
import { AgentRegistry } from '../agents/AgentRegistry';
import { extractReplyArray } from '../ai/parseUtils';
import { AGENT_MAP } from '../constants/agentMap';
import { cleanTextForAi } from '../utils/contentCleaner';
import { extractTrackingNumbers, isLogisticsRelated, formatTrackingContext } from '../utils/trackingUtils';
import type { AgentDefinition, AgentExecuteInput, AgentStreamChunk } from '../types/server';

/** 单条 prompt 最大长度阈值 */
const MAX_SINGLE_PROMPT_LENGTH = 12000;
/** 每段内容的目标大小 */
const CHUNK_SIZE = 10000;
/** 上下文最大长度 */
const MAX_CONTEXT_LENGTH = 30000;
/** 单条对话最大长度 */
const MAX_SINGLE_CONVERSATION_LENGTH = 3000;

interface AiReplyOptions {
    onStatusChange?: (status: 'replying' | null) => void;
    onError?: (error: string) => void;
    onStreamChunk?: (text: string) => void;
    onParsed?: (replies: [string, string]) => void;
    onPromptReady?: (prompt: string) => void;
    autoSave?: boolean;
}

/**
 * 从工单数据构建 AI 查询的上下文文本
 */
function buildContext(ticket: any): string {
    let parsedData: any = {};
    try {
        parsedData = JSON.parse(ticket.content || '{}');
    } catch { /* ignore */ }

    let context = `【TICKET SUBJECT】: ${ticket.subject}\n`;
    context += `【INITIAL DESCRIPTION】: ${cleanTextForAi(parsedData?.description || '') || 'No description content'}\n\n`;

    if (parsedData?.conversations && parsedData.conversations.length > 0) {
        const conversations = parsedData.conversations;
        const separator = "--------------------------------------------------\n";

        const formattedConvs: string[] = [];
        for (const conv of conversations) {
            const userIdStr = String(conv.userId);
            const agentName = AGENT_MAP[userIdStr];
            const role = agentName ? `AGENT (${agentName})` : (conv.incoming ? 'CUSTOMER' : 'AGENT');
            const timeStr = conv.createdAt || 'Unknown Time';

            let bodyText = cleanTextForAi(conv.bodyText || '');
            if (bodyText.length > MAX_SINGLE_CONVERSATION_LENGTH) {
                bodyText = bodyText.substring(0, MAX_SINGLE_CONVERSATION_LENGTH) + '\n...[内容已截断]';
            }

            formattedConvs.push(`[${timeStr}] <${role}>:\n${bodyText}\n${separator}`);
        }

        const header = "【DETAILED INTERACTION LOGS】:\n" + separator;
        const availableLength = MAX_CONTEXT_LENGTH - context.length - header.length;

        let totalLength = 0;
        let startIndex = 0;

        for (let i = formattedConvs.length - 1; i >= 0; i--) {
            if (totalLength + formattedConvs[i].length > availableLength) {
                startIndex = i + 1;
                break;
            }
            totalLength += formattedConvs[i].length;
        }

        context += header;

        if (startIndex > 0) {
            console.log(`[useAiReply] Truncating ${startIndex} oldest conversation(s) to fit context limit`);
            context += `[... 已省略最早的 ${startIndex} 条对话记录 ...]\n${separator}`;
        }

        for (let i = startIndex; i < formattedConvs.length; i++) {
            context += formattedConvs[i];
        }
    }

    return context;
}

/**
 * 按对话边界将内容切分为多段
 */
function splitByBoundary(text: string, maxChunkSize: number): string[] {
    const separator = '--------------------------------------------------';
    const sections = text.split(separator);
    const chunks: string[] = [];
    let current = '';

    for (const section of sections) {
        if (current.length + section.length + separator.length > maxChunkSize && current.length > 0) {
            chunks.push(current.trim());
            current = section;
        } else {
            current += (current ? separator : '') + section;
        }
    }
    if (current.trim()) chunks.push(current.trim());

    const result: string[] = [];
    for (const chunk of chunks) {
        if (chunk.length <= maxChunkSize) {
            result.push(chunk);
        } else {
            for (let i = 0; i < chunk.length; i += maxChunkSize) {
                result.push(chunk.substring(i, i + maxChunkSize));
            }
        }
    }
    return result;
}

/**
 * 根据内容长度决定构建单条或多条消息
 */
function buildMessages(context: string, promptTemplate: string): string[] {
    const finalPrompt = promptTemplate.replace('${工单内容}', context);

    if (finalPrompt.length <= MAX_SINGLE_PROMPT_LENGTH) {
        return [finalPrompt];
    }

    console.log(`[useAiReply] Content too long (${finalPrompt.length} chars), splitting into multi-round messages`);

    const instruction = promptTemplate.replace('${工单内容}', '').trim();
    const messages: string[] = [];

    messages.push(
        "I will send you ticket content in multiple parts. " +
        "Please reply with just 'OK' after receiving each part. " +
        "DO NOT generate the final reply until I send the message starting with '[END_OF_INPUT]'."
    );

    const chunks = splitByBoundary(context, CHUNK_SIZE);
    console.log(`[useAiReply] Split into ${chunks.length} chunks`);
    chunks.forEach((chunk, i) => {
        messages.push(`[Part ${i + 1}/${chunks.length}]\n${chunk}`);
    });

    messages.push(
        `[END_OF_INPUT]\n\nAll ticket content has been sent. Now please follow the instruction below:\n\n${instruction}`
    );

    return messages;
}

/**
 * 创建 NotebookLM Shadow Window 处理函数
 */
async function* createNotebookShadowHandler(
    definition: AgentDefinition,
    input: AgentExecuteInput,
): AsyncGenerator<AgentStreamChunk> {
    const { NotebookShadowService } = await import('../../tauri/services/notebookShadow');
    const config = typeof definition.providerConfig === 'string'
        ? JSON.parse(definition.providerConfig) : definition.providerConfig;

    const notebookId = input.params?.notebookId || config.notebookId;
    const notebookUrl = input.params?.notebookUrl || config.notebookUrl;
    const messages = input.data?.messages as string[];

    if (!notebookId) {
        yield { text: '缺少 notebookId 配置', status: 'error' };
        return;
    }

    const shadowService = new NotebookShadowService(notebookId, notebookUrl);

    if (messages.length === 1) {
        for await (const chunk of shadowService.query(messages[0])) {
            yield { text: chunk.text, status: chunk.status as AgentStreamChunk['status'] };
        }
    } else {
        for await (const chunk of shadowService.queryMultiRound(messages)) {
            yield { text: chunk.text, status: chunk.status as AgentStreamChunk['status'] };
        }
    }
}

/** 解析 agent definition 的 providerConfig */
function parseProviderConfig(config: string | Record<string, any>): Record<string, any> {
    if (typeof config === 'object' && config !== null) return config;
    try { return JSON.parse(config || '{}'); } catch { return {}; }
}

export function useAiReply() {
    const { setProcessStatus, setActiveReplyingId, setTempAiReply, getActiveReplyingId } = useTicketProcess();

    const runReply = useCallback(async (ticket: any, options: AiReplyOptions = {}) => {
        const { onStatusChange, onError, onStreamChunk, onParsed, onPromptReady, autoSave } = options;

        console.log(`[useAiReply] Starting reply generation for ticket #${ticket.id}, autoSave=${autoSave}`);

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
            const registry = AgentRegistry.getInstance();
            const resolved = registry.resolveByCapability('reply');

            if (!resolved) {
                if (!registry.hasBinding('reply')) {
                    throw new Error('回复能力未配置 Agent，请在 Agent 管理 → 能力绑定页面为 "reply" 配置 Agent');
                }
                throw new Error('绑定的回复 Agent 在当前环境不可用，请检查 Agent 配置或更换可用的 Agent');
            }

            const { definition, executor } = resolved;

            // 从 agent definition 的 providerConfig 读取配置
            const agentConfig = parseProviderConfig(definition.providerConfig);

            // 配置检查（Shadow Window 类型需要 notebookId）
            if (definition.providerType === 'SHADOW_WINDOW' && !agentConfig.notebookId) {
                const err = '请先在 Agent 管理中配置 Notebook ID';
                onError?.(err);
                setActiveReplyingId(null);
                setProcessStatus(ticket.id, null);
                onStatusChange?.(null);
                return false;
            }

            const promptTemplate = agentConfig.prompt || '请根据以下工单内容回答我的问题:\n\n${工单内容}';
            onPromptReady?.(promptTemplate);

            console.log(`[useAiReply] Using agent: ${definition.code} (${definition.name})`);

            // 构建上下文
            let context = buildContext(ticket);

            // 注入审核驳回反馈
            if (ticket.lastAuditRemark) {
                context += "\n【PREVIOUS AUDIT FEEDBACK】:\n";
                context += `审核意见: ${ticket.lastAuditRemark}\n`;
                context += "请根据以上审核反馈改进你的回复，避免重复之前的问题。\n\n";
            }

            // 物流信息自动注入
            try {
                const trackingNumbers = extractTrackingNumbers(context);
                if (trackingNumbers.length > 0 && isLogisticsRelated(ticket.subject, context)) {
                    console.log(`[useAiReply] Detected logistics ticket with ${trackingNumbers.length} tracking number(s), querying...`);
                    onStreamChunk?.('');

                    const { TrackingShadowService } = await import('../../tauri/services/trackingShadow');
                    const trackingService = new TrackingShadowService();
                    const trackingResults = await trackingService.queryMultiple(trackingNumbers.slice(0, 3));
                    const trackingContext = formatTrackingContext(trackingResults);
                    if (trackingContext) {
                        context += trackingContext;
                        console.log(`[useAiReply] Logistics context injected (${trackingContext.length} chars)`);
                    }
                }
            } catch (err) {
                console.warn('[useAiReply] Logistics query failed, proceeding without:', err);
            }

            // 构建消息（处理分段）
            const messages = buildMessages(context, promptTemplate);

            // 准备 agent 输入（notebookId/notebookUrl 已在 definition.providerConfig 中）
            const agentInput: AgentExecuteInput = {
                data: { messages },
                params: {
                    shadowHandler: createNotebookShadowHandler,
                },
                referenceType: 'ticket',
                referenceId: ticket.id,
            };

            let saveSuccess = false;
            let saveError: Error | null = null;
            let finalParsed: [string, string] | null = null;

            // 流式处理
            if (executor.executeStream) {
                for await (const chunk of executor.executeStream(definition, agentInput)) {
                    if (chunk.status === 'error') {
                        throw new Error(chunk.text);
                    }

                    onStreamChunk?.(chunk.text);

                    // 尝试解析回复
                    if (chunk.status === 'complete' || (chunk.text.includes('[') && chunk.text.includes(']'))) {
                        const parsed = extractReplyArray(chunk.text);

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
            } else {
                throw new Error(`Agent "${definition.code}" 不支持流式执行`);
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
    }, [setActiveReplyingId, setProcessStatus, setTempAiReply, getActiveReplyingId]);

    return { runReply };
}
