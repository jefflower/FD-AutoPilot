/**
 * 回复辅助函数
 *
 * 从 useAiReply.ts 提取的独立副本，供 ShadowExecutor 标准化路径使用。
 * useAiReply.ts 中的原始函数暂时保留（Phase 3 切换后移除）。
 */

import { AGENT_MAP } from '../../constants/agentMap';
import { cleanTextForAi } from '../../utils/contentCleaner';
import { extractReplyArray } from '../../ai/parseUtils';

/** 单条 prompt 最大长度阈值 */
const MAX_SINGLE_PROMPT_LENGTH = 12000;
/** 每段内容的目标大小 */
const CHUNK_SIZE = 10000;
/** 上下文最大长度 */
const MAX_CONTEXT_LENGTH = 30000;
/** 单条对话最大长度 */
const MAX_SINGLE_CONVERSATION_LENGTH = 3000;

/**
 * 从工单数据构建 AI 回复上下文文本
 * 可选注入审核反馈和物流信息
 */
export function buildReplyContext(
    ticket: any,
    lastAuditRemark?: string,
    options?: { trackingContext?: string }
): string {
    let parsedData: any = {};
    try { parsedData = JSON.parse(ticket.content || '{}'); } catch { /* ignore */ }

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
            context += `[... 已省略最早的 ${startIndex} 条对话记录 ...]\n${separator}`;
        }

        for (let i = startIndex; i < formattedConvs.length; i++) {
            context += formattedConvs[i];
        }
    }

    // 注入审核驳回反馈
    if (lastAuditRemark) {
        context += "\n【PREVIOUS AUDIT FEEDBACK】:\n";
        context += `审核意见: ${lastAuditRemark}\n`;
        context += "请根据以上审核反馈改进你的回复，避免重复之前的问题。\n\n";
    }

    // 注入物流信息（可选）
    if (options?.trackingContext) {
        context += options.trackingContext;
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
 * 按长度决定单条或多条消息
 */
export function buildReplyMessages(context: string, promptTemplate: string): string[] {
    const finalPrompt = promptTemplate.replace('${工单内容}', context);

    if (finalPrompt.length <= MAX_SINGLE_PROMPT_LENGTH) {
        return [finalPrompt];
    }

    console.log(`[replyHelpers] Content too long (${finalPrompt.length} chars), splitting into multi-round messages`);

    const instruction = promptTemplate.replace('${工单内容}', '').trim();
    const messages: string[] = [];

    messages.push(
        "I will send you ticket content in multiple parts. " +
        "Please reply with just 'OK' after receiving each part. " +
        "DO NOT generate the final reply until I send the message starting with '[END_OF_INPUT]'."
    );

    const chunks = splitByBoundary(context, CHUNK_SIZE);
    chunks.forEach((chunk, i) => {
        messages.push(`[Part ${i + 1}/${chunks.length}]\n${chunk}`);
    });

    messages.push(
        `[END_OF_INPUT]\n\nAll ticket content has been sent. Now please follow the instruction below:\n\n${instruction}`
    );

    return messages;
}

/**
 * 解析 AI 回复输出为结构化格式
 */
export function parseReplyOutput(text: string): { targetReply: string; zhReply: string } | null {
    const parsed = extractReplyArray(text);
    if (parsed) {
        return { targetReply: parsed[0], zhReply: parsed[1] };
    }
    return null;
}
