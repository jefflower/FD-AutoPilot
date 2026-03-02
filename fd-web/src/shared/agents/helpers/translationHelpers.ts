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
 * 将工单格式化为 JSON 字符串（content JSON 已含 subject，直接清洗后序列化）
 */
export function formatTicketContent(ticket: any): string {
    let parsedData: any = {};
    try { parsedData = JSON.parse(ticket.content || '{}'); } catch { /* ignore */ }

    // content JSON 已含 subject，构建清洗后的 JSON
    const cleanedContent: any = {
        subject: parsedData?.subject || ticket.subject || '',
        description: cleanTextForAi(parsedData?.description || ''),
        conversations: (parsedData?.conversations || []).map((c: any) => ({
            id: c.id,
            bodyText: cleanTextForAi(c.bodyText || ''),
            userId: c.userId,
            createdAt: c.createdAt,
            incoming: (c.incoming !== false && !AGENT_MAP[String(c.userId)]),
            isPrivate: c.isPrivate || false,
        })),
    };

    return JSON.stringify(cleanedContent, null, 2);
}

/**
 * 从 AI 原始输出中提取 JSON（处理 markdown 围栏、数组/对象格式）
 *
 * 支持：
 * - markdown 代码块包裹：```json ... ```
 * - 纯 JSON 对象 { ... }
 * - 纯 JSON 数组 [ ... ]
 * - 带前后文本的 JSON
 */
export function extractJsonObject(raw: string): string {
    let cleaned = raw.trim();

    // 1. 先剥离 markdown 代码块
    const codeBlockMatch = cleaned.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
    }

    // 2. 尝试提取 JSON 对象 { ... }
    const objStart = cleaned.indexOf('{');
    const objEnd = cleaned.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
        const candidate = cleaned.substring(objStart, objEnd + 1);
        try {
            JSON.parse(candidate);
            return candidate;
        } catch { /* 继续尝试其他格式 */ }
    }

    // 3. 尝试提取 JSON 数组 [ ... ]
    const arrStart = cleaned.indexOf('[');
    const arrEnd = cleaned.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
        const candidate = cleaned.substring(arrStart, arrEnd + 1);
        try {
            JSON.parse(candidate);
            return candidate;
        } catch { /* 继续 */ }
    }

    // 4. 直接尝试解析整个 cleaned 字符串
    try {
        JSON.parse(cleaned);
        return cleaned;
    } catch { /* fall through */ }

    throw new Error(`翻译输出中未找到有效 JSON：${cleaned.substring(0, 100)}...`);
}

/**
 * 为 HTTP_API Agent 构建文本 prompt
 */
export function buildHttpApiPrompt(ticket: any, targetLang: string): string {
    const langName = langCodeToName(targetLang);
    const ticketContent = formatTicketContent(ticket);

    return `Translate the following JSON into ${langName}.\n` +
        `Translate only text fields (subject, description, bodyText). ` +
        `Keep all other fields unchanged. Return the same JSON structure.\n\n` +
        ticketContent;
}

/**
 * 将翻译结果映射为 TranslationSubmitData
 *
 * AI 返回同构 JSON（与输入结构一致），直接使用 camelCase 字段名，
 * 兼容 snake_case（AI 可能仍返回 body_text / description_text 等）。
 */
export function mapTranslationResult(result: any, ticket: any, lang: string): TranslationSubmitData {
    let parsedData: any = {};
    try { parsedData = JSON.parse(ticket.content || '{}'); } catch { /* ignore */ }

    // AI 返回同构 JSON，直接使用字段名（camelCase），兼容 snake_case
    const translatedConversations = result.conversations?.filter((c: any) => c.id != null).map((c: any) => ({
        id: c.id,
        bodyText: c.bodyText || c.body_text || '',
        userId: c.userId ?? c.user_id,
        createdAt: c.createdAt ?? c.created_at,
        incoming: c.incoming,
        isPrivate: c.isPrivate ?? c.is_private ?? c.private,
    })) || [];

    // 兜底：AI 未翻译对话时保留原始
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
            `[mapTranslationResult] AI 未翻译对话：原始 ${originalConversations.length} 条，已回退。ticketId=${ticket.id}`
        );
    }

    // translatedContent 现在也包含 subject（与输入同构）
    const translatedContent = JSON.stringify({
        subject: result.subject || parsedData?.subject || ticket.subject || '',
        description: result.description || result.descriptionText || result.description_text || '',
        conversations: finalConversations
    });

    return {
        targetLang: lang,
        translatedTitle: result.subject || parsedData?.subject || ticket.subject,
        translatedContent,
    };
}
