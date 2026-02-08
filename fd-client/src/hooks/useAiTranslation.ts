import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { serverApi } from '../services/serverApi';
import { useSettings } from './useSettings';
import { useTicketProcess } from './useTicketProcess';
import { AGENT_MAP } from '../constants/agentMap';

interface AiTranslationOptions {
    onStatusChange?: (status: 'translating' | null) => void;
    onError?: (error: string) => void;
    autoSave?: boolean;
}

export function useAiTranslation() {
    const { translationLang } = useSettings();
    const { setProcessStatus, setTempTranslation } = useTicketProcess();

    const runTranslation = useCallback(async (ticket: any, options: AiTranslationOptions = {}) => {
        const { onStatusChange, onError, autoSave } = options;

        console.log(`[useAiTranslation] Starting translation for ticket #${ticket.id}, autoSave=${autoSave}`);
        setProcessStatus(ticket.id, 'translating');
        onStatusChange?.('translating');

        try {
            // 解析 ticket content
            let parsedData: any = {};
            try {
                parsedData = JSON.parse(ticket.content || '{}');
            } catch (e) {
                console.warn('[useAiTranslation] Failed to parse ticket content:', e);
            }

            // 构造 Rust 期望的 Ticket 结构
            const rustTicket = {
                id: ticket.id,
                externalId: ticket.externalId,
                subject: ticket.subject,
                descriptionText: parsedData?.description || '',
                content: ticket.content,
                status: ticket.status,
                priority: 0,
                createdAt: ticket.createdAt,
                conversations: (parsedData?.conversations || []).map((c: any) => ({
                    id: c.id,
                    body_text: c.bodyText,
                    user_id: c.userId,
                    created_at: c.createdAt,
                    incoming: (c.incoming !== false && !AGENT_MAP[String(c.userId)]),
                    private: c.isPrivate || false,
                }))
            };

            // 使用配置的语言 (默认 zh-CN)
            let targetLang = translationLang || 'zh-CN';
            if (targetLang === 'cn') targetLang = 'zh-CN';

            console.log(`[useAiTranslation] Invoking translation with targetLang: ${targetLang}`);

            // 调用 Rust 命令进行直接翻译
            const result = (await invoke('translate_ticket_direct_cmd', {
                ticket: rustTicket,
                targetLang: targetLang
            })) as any;

            console.log('[useAiTranslation] Translation Result RAW:', result);

            // 构造翻译后的 content
            const translatedConversations = result.conversations?.map((c: any) => ({
                id: c.id,
                bodyText: c.bodyText || c.body_text || '',
                userId: c.userId || c.user_id,
                createdAt: c.createdAt || c.created_at,
                incoming: c.incoming,
                isPrivate: c.private || c.is_private
            })) || [];

            const finalTranslatedContent = JSON.stringify({
                description: result.descriptionText || result.description_text || '',
                conversations: translatedConversations
            });

            const translationData = {
                targetLang: targetLang,
                translatedTitle: result.subject || ticket.subject,
                translatedContent: finalTranslatedContent,
            };

            if (autoSave) {
                console.log(`[useAiTranslation] autoSave triggered for ticket #${ticket.id}. Calling serverApi.ticket.submitTranslation...`);
                await serverApi.ticket.submitTranslation(ticket.id, translationData);
                console.log(`[useAiTranslation] serverApi.ticket.submitTranslation completed successfully for #${ticket.id}`);
            } else {
                setTempTranslation(ticket.id, translationData);
            }
            return true;
        } catch (e) {
            console.error('[useAiTranslation] Error:', e);
            const errMsg = (e as Error).message || String(e);
            onError?.(errMsg);
            return false;
        } finally {
            console.log(`[useAiTranslation] Finished for #${ticket.id}`);
            setProcessStatus(ticket.id, null);
            onStatusChange?.(null);
        }
    }, [translationLang, setProcessStatus, setTempTranslation]);

    return { runTranslation };
}
