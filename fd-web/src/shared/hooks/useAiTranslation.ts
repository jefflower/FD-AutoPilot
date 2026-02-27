import { useCallback } from 'react';
import { serverApi } from '../services/serverApi';
import { useSettings } from './useSettings';
import { AgentRegistry } from '../agents/AgentRegistry';
import type { AgentExecuteResult, StandardAgentInput, TranslationSubmitData } from '../types/server';

interface AiTranslationOptions {
    onStatusChange?: (status: 'translating' | null) => void;
    onError?: (error: string) => void;
    onResult?: (data: TranslationSubmitData) => void;
    autoSave?: boolean;
}

/**
 * 将翻译结果映射为 TranslationSubmitData
 */
function mapTranslationResult(result: any, ticket: any, lang: string): TranslationSubmitData {
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

    // 兜底：AI 返回空 conversations 但原始工单有对话时，保留原始对话（未翻译总比丢失好）
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

export function useAiTranslation() {
    const { translationLang } = useSettings();

    const runTranslation = useCallback(async (ticket: any, options: AiTranslationOptions = {}): Promise<boolean> => {
        const { onStatusChange, onError, onResult, autoSave } = options;

        console.log(`[useAiTranslation] Starting translation for ticket #${ticket.id}, autoSave=${autoSave}`);
        onStatusChange?.('translating');

        try {
            const registry = AgentRegistry.getInstance();

            // 优先使用注入的 agentCode（面板指定 > 工作流指定 > capability 绑定）
            const injectedAgentCode = (ticket as any)._agentCode as string | undefined;
            let resolved = injectedAgentCode
                ? registry.resolve(injectedAgentCode)
                : registry.resolveByCapability('translation');

            // Fallback: 指定 agent 不可用时，按 capability 查找可用替代
            if (!resolved && injectedAgentCode) {
                console.warn(`[useAiTranslation] Agent "${injectedAgentCode}" 不可用，尝试 capability fallback`);
                resolved = registry.resolveByCapability('translation');
            }

            if (!resolved) {
                if (!registry.hasBinding('translation')) {
                    throw new Error('翻译能力未配置 Agent，请在 Agent 管理 → 能力绑定页面为 "translation" 配置 Agent');
                }
                throw new Error('绑定的翻译 Agent 在当前环境不可用，请检查 Agent 配置或更换可用的 Agent');
            }

            const { definition, executor } = resolved;
            let targetLang = translationLang || 'zh-CN';
            if (targetLang === 'cn') targetLang = 'zh-CN';

            console.log(`[useAiTranslation] Using agent: ${definition.code} (${definition.name}), providerType: ${definition.providerType}, targetLang: ${targetLang}`);

            // 标准化路径：构建 StandardAgentInput，Executor 自行构建 prompt
            // 优先使用工作流注入的 agentInput（来自 TaskInstance payload）
            const workflowInput = (ticket as any)._agentInput as StandardAgentInput | undefined;
            const standardInput: StandardAgentInput = workflowInput || {
                ticket: { id: ticket.id, subject: ticket.subject, content: ticket.content },
                targetLang,
            };
            // 确保 targetLang 存在（工作流输入可能未携带）
            if (!standardInput.targetLang) {
                standardInput.targetLang = targetLang;
            }
            console.log(`[useAiTranslation] Standard path: agent=${definition.code}, targetLang=${standardInput.targetLang}, fromWorkflow=${!!workflowInput}`);

            const execResult: AgentExecuteResult = await executor.execute(definition, {
                data: standardInput,
                referenceType: 'ticket',
                referenceId: ticket.id,
            });

            if (!execResult.success) {
                throw new Error(execResult.error || 'Agent 翻译执行失败');
            }

            // 映射结果
            const translationData = mapTranslationResult(execResult.output, ticket, targetLang);

            if (autoSave) {
                console.log(`[useAiTranslation] autoSave triggered for ticket #${ticket.id}`);
                await serverApi.ticket.submitTranslation(ticket.id, translationData);
            }
            // 通过回调传递翻译结果，调用方自行决定如何使用（存本地状态或全局状态）
            onResult?.(translationData);
            return true;
        } catch (e) {
            console.error('[useAiTranslation] Error:', e);
            const errMsg = (e as Error).message || String(e);
            onError?.(errMsg);
            return false;
        } finally {
            onStatusChange?.(null);
        }
    }, [translationLang]);

    return { runTranslation };
}
