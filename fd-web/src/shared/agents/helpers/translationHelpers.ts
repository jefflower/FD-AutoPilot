/**
 * 翻译辅助函数
 *
 * 从 useAiTranslation.ts 提取的独立副本，供 CliExecutor / HttpApiExecutor 标准化路径使用。
 * useAiTranslation.ts 中的原始函数暂时保留（Phase 3 切换后移除）。
 */

import { cleanTextForAi } from '../../utils/contentCleaner';
import { AGENT_MAP } from '../../constants/agentMap';
import type { TranslationSubmitData } from '../../types/server';

/**
 * 语言代码 -> 语言名称（与 Rust ai.rs 中的 lang_code_to_name 一致）
 */
export function langCodeToName(code: string): string {
    const map: Record<string, string> = {
        'cn': 'Simplified Chinese',
        'zh-CN': 'Simplified Chinese',
        'en': 'English',
        'jp': 'Japanese',
    };
    return map[code] || code;
}

/**
 * 将工单格式化为文本内容（用于替换 systemPrompt 中的 ${TICKET_CONTENT}）
 */
export function formatTicketContent(ticket: any): string {
    let parsedData: any = {};
    try { parsedData = JSON.parse(ticket.content || '{}'); } catch { /* ignore */ }

    let content = `--- TICKET TO TRANSLATE ---\nSUBJECT: ${ticket.subject || ''}\n`;

    const desc = parsedData?.description;
    if (desc) {
        content += `DESCRIPTION: ${cleanTextForAi(desc)}\n`;
    }

    const conversations = parsedData?.conversations || [];
    if (conversations.length > 0) {
        content += 'CONVERSATIONS:\n';
        for (const c of conversations) {
            content += `MSG_ID ${c.id}: ${cleanTextForAi(c.bodyText || '')}\n`;
        }
    }

    return content;
}

/**
 * 从 AI 原始输出中提取 JSON 对象（处理 markdown 围栏等）
 */
export function extractJsonObject(raw: string): string {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error(`翻译输出中未找到 JSON 对象`);
    }
    return raw.substring(start, end + 1);
}

/**
 * 为 HTTP_API Agent 构建文本 prompt
 */
export function buildHttpApiPrompt(ticket: any, targetLang: string): string {
    let parsedData: any = {};
    try {
        parsedData = JSON.parse(ticket.content || '{}');
    } catch { /* ignore */ }

    const conversations = (parsedData?.conversations || []).map((c: any) => ({
        id: c.id,
        bodyText: cleanTextForAi(c.bodyText || ''),
        userId: c.userId,
        createdAt: c.createdAt,
        incoming: (c.incoming !== false && !AGENT_MAP[String(c.userId)]),
        isPrivate: c.isPrivate || false,
    }));

    const ticketData = {
        subject: ticket.subject,
        descriptionText: cleanTextForAi(parsedData?.description || ''),
        conversations,
    };

    return `Translate the following ticket content to ${targetLang}.\n\n` +
        `TICKET DATA (JSON):\n${JSON.stringify(ticketData, null, 2)}`;
}

/**
 * 将翻译结果映射为 TranslationSubmitData
 */
export function mapTranslationResult(result: any, ticket: any, lang: string): TranslationSubmitData {
    let parsedData: any = {};
    try {
        parsedData = JSON.parse(ticket.content || '{}');
    } catch { /* ignore */ }

    const translatedConversations = result.conversations?.filter((c: any) => c.id != null).map((c: any) => ({
        id: c.id,
        bodyText: c.bodyText || c.body_text || '',
        userId: c.userId || c.user_id,
        createdAt: c.createdAt || c.created_at,
        incoming: c.incoming,
        isPrivate: c.private || c.is_private
    })) || [];

    // 兜底：AI 返回空 conversations 但原始工单有对话时，保留原始对话
    const originalConversations = parsedData?.conversations || [];
    const finalConversations = (translatedConversations.length > 0)
        ? translatedConversations
        : originalConversations.map((c: any) => ({
            id: c.id,
            bodyText: c.bodyText || '',
            userId: c.userId,
            createdAt: c.createdAt,
            incoming: c.incoming,
            isPrivate: c.isPrivate,
        }));

    if (originalConversations.length > 0 && translatedConversations.length === 0) {
        console.warn(
            `[mapTranslationResult] AI 未翻译对话：原始工单有 ${originalConversations.length} 条对话，` +
            `翻译结果 conversations 为空。ticketId=${ticket.id}，已回退到原始对话`
        );
    }

    const translatedContent = JSON.stringify({
        description: result.descriptionText || result.description_text || '',
        conversations: finalConversations
    });

    return {
        targetLang: lang,
        translatedTitle: result.subject || ticket.subject,
        translatedContent,
    };
}
