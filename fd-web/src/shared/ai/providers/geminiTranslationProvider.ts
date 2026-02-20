import { isTauriEnv, tauriInvoke } from '../../../tauri/bridge';
import { AiTranslationProvider, TranslationInput, TranslationOutput } from '../types';
import { AGENT_MAP } from '../../constants/agentMap';
import { cleanTextForAi } from '../../utils/contentCleaner';

/**
 * Gemini CLI 翻译 Provider
 *
 * 通过 Tauri invoke 调用 Rust 端的 Gemini CLI 进行翻译。
 * Rust 端负责：构造 prompt → 调用 gemini CLI → 解析 JSON 结果。
 */
export class GeminiTranslationProvider implements AiTranslationProvider {
    readonly name = 'gemini-cli';

    async translate(input: TranslationInput): Promise<TranslationOutput> {
        if (!isTauriEnv()) {
            throw new Error('Gemini CLI 翻译仅在桌面客户端可用。请使用 Tauri 桌面客户端，或等待服务端翻译功能。');
        }

        const { ticket, targetLang } = input;

        // 解析 ticket content JSON
        let parsedData: any = {};
        try {
            parsedData = JSON.parse(ticket.content || '{}');
        } catch (e) {
            console.warn('[GeminiTranslationProvider] Failed to parse ticket content:', e);
        }

        // 构造 Rust 期望的 Ticket 结构
        const rustTicket = {
            id: ticket.id,
            externalId: ticket.externalId,
            subject: ticket.subject,
            descriptionText: cleanTextForAi(parsedData?.description || ''),
            content: ticket.content,
            status: ticket.status,
            priority: 0,
            createdAt: ticket.createdAt,
            conversations: (parsedData?.conversations || []).map((c: any) => ({
                id: c.id,
                body_text: cleanTextForAi(c.bodyText || ''),
                user_id: c.userId,
                created_at: c.createdAt,
                incoming: (c.incoming !== false && !AGENT_MAP[String(c.userId)]),
                private: c.isPrivate || false,
            }))
        };

        // 标准化语言代码
        let lang = targetLang;
        if (lang === 'cn') lang = 'zh-CN';

        // 调用 Rust Gemini CLI 翻译
        const result = (await tauriInvoke('translate_ticket_direct_cmd', {
            ticket: rustTicket,
            targetLang: lang
        })) as any;

        // 映射结果字段
        const translatedConversations = result.conversations?.map((c: any) => ({
            id: c.id,
            bodyText: c.bodyText || c.body_text || '',
            userId: c.userId || c.user_id,
            createdAt: c.createdAt || c.created_at,
            incoming: c.incoming,
            isPrivate: c.private || c.is_private
        })) || [];

        // 验证翻译完整性：如果原始工单有 conversations，翻译结果也必须有
        const originalConversations = parsedData?.conversations || [];
        if (originalConversations.length > 0 && translatedConversations.length === 0) {
            throw new Error(
                `[GeminiTranslationProvider] 翻译不完整：原始工单有 ${originalConversations.length} 条对话，` +
                `但 Gemini 返回的翻译结果中 conversations 为空。ticketId=${ticket.id}`
            );
        }

        const translatedContent = JSON.stringify({
            description: result.descriptionText || result.description_text || '',
            conversations: translatedConversations
        });

        return {
            targetLang: lang,
            translatedTitle: result.subject || ticket.subject,
            translatedContent,
        };
    }
}
