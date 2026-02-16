import { useCallback } from 'react';
import { serverApi } from '../services/serverApi';
import { useSettings } from './useSettings';
import { useTicketProcess } from './useTicketProcess';
import { getTranslationProvider } from '../ai';

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
            const provider = getTranslationProvider('gemini-cli');
            const targetLang = translationLang || 'zh-CN';

            console.log(`[useAiTranslation] Using provider: ${provider.name}, targetLang: ${targetLang}`);

            const translationData = await provider.translate({ ticket, targetLang });

            if (autoSave) {
                console.log(`[useAiTranslation] autoSave triggered for ticket #${ticket.id}`);
                await serverApi.ticket.submitTranslation(ticket.id, translationData);
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
            setProcessStatus(ticket.id, null);
            onStatusChange?.(null);
        }
    }, [translationLang, setProcessStatus, setTempTranslation]);

    return { runTranslation };
}
