import { useCallback } from 'react';
import { serverApi } from '../services/serverApi';
import { useSettings } from './useSettings';
import { useTicketProcess } from './useTicketProcess';
import { AgentRegistry } from '../agents/AgentRegistry';
import { AGENT_MAP } from '../constants/agentMap';
import { cleanTextForAi } from '../utils/contentCleaner';
import type { AgentExecutor } from '../agents/executors/types';
import type { AgentDefinition, AgentExecuteResult, TranslationSubmitData } from '../types/server';

interface AiTranslationOptions {
    onStatusChange?: (status: 'translating' | null) => void;
    onError?: (error: string) => void;
    autoSave?: boolean;
}

/**
 * 解析 providerConfig（可能是 string 或 object）
 */
function parseProviderConfig(config: string | Record<string, any> | undefined): Record<string, any> {
    if (typeof config === 'object' && config !== null) return config;
    try { return JSON.parse(config || '{}'); } catch { return {}; }
}

/**
 * 语言代码 → 语言名称（与 Rust ai.rs 中的 lang_code_to_name 一致）
 */
function langCodeToName(code: string): string {
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
function formatTicketContent(ticket: any): string {
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
function extractJsonObject(raw: string): string {
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
function buildHttpApiPrompt(ticket: any, targetLang: string): string {
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
 * 根据 Agent 类型执行翻译
 */
async function executeTranslation(
    definition: AgentDefinition,
    executor: AgentExecutor,
    ticket: any,
    targetLang: string,
): Promise<AgentExecuteResult> {
    if (definition.providerType === 'HTTP_API') {
        // HTTP_API 路径：构建文本 prompt，服务端调用 LLM
        const prompt = buildHttpApiPrompt(ticket, targetLang);
        console.log(`[useAiTranslation] HTTP_API prompt length: ${prompt.length}`);

        return executor.execute(definition, {
            data: prompt,
            params: { targetLang },
            referenceType: 'ticket',
            referenceId: ticket.id,
        });
    }

    // LOCAL_CLI 路径：前端构建完整 prompt，传给通用 gemini 命令
    const agentConfig = parseProviderConfig(definition.providerConfig);
    const systemPrompt = agentConfig.systemPrompt || '';
    const langName = langCodeToName(targetLang);
    const ticketContent = formatTicketContent(ticket);

    // 替换占位符（使用函数形式避免 replacement string 中 $ 引起的问题）
    const resolvedPrompt = systemPrompt
        .replace(/\$\{TARGET_LANG\}/g, () => langName)
        .replace(/\$\{TICKET_CONTENT\}/g, () => ticketContent);

    const models = Array.isArray(agentConfig.models)
        ? agentConfig.models
        : (agentConfig.model ? [agentConfig.model] : []);

    console.log(`[useAiTranslation] LOCAL_CLI prompt length: ${resolvedPrompt.length}, models: [${models.join(', ')}]`);

    const result = await executor.execute(definition, {
        data: { prompt: resolvedPrompt, models },
        params: {},
        referenceType: 'ticket',
        referenceId: ticket.id,
    });

    // 解析 gemini 原始输出为结构化翻译结果
    if (result.success && typeof result.output === 'string') {
        try {
            const jsonStr = extractJsonObject(result.output);
            result.output = JSON.parse(jsonStr);
        } catch (e) {
            result.success = false;
            result.error = `翻译结果 JSON 解析失败: ${(e as Error).message}`;
        }
    }

    return result;
}

/**
 * 将翻译结果映射为 TranslationSubmitData
 */
function mapTranslationResult(result: any, ticket: any, lang: string): TranslationSubmitData {
    let parsedData: any = {};
    try {
        parsedData = JSON.parse(ticket.content || '{}');
    } catch { /* ignore */ }

    const translatedConversations = result.conversations?.map((c: any) => ({
        id: c.id,
        bodyText: c.bodyText || c.body_text || '',
        userId: c.userId || c.user_id,
        createdAt: c.createdAt || c.created_at,
        incoming: c.incoming,
        isPrivate: c.private || c.is_private
    })) || [];

    // 验证翻译完整性
    const originalConversations = parsedData?.conversations || [];
    if (originalConversations.length > 0 && translatedConversations.length === 0) {
        throw new Error(
            `翻译不完整：原始工单有 ${originalConversations.length} 条对话，` +
            `但翻译结果中 conversations 为空。ticketId=${ticket.id}`
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

export function useAiTranslation() {
    const { translationLang } = useSettings();
    const { setProcessStatus, setTempTranslation } = useTicketProcess();

    const runTranslation = useCallback(async (ticket: any, options: AiTranslationOptions = {}) => {
        const { onStatusChange, onError, autoSave } = options;

        console.log(`[useAiTranslation] Starting translation for ticket #${ticket.id}, autoSave=${autoSave}`);
        setProcessStatus(ticket.id, 'translating');
        onStatusChange?.('translating');

        try {
            const registry = AgentRegistry.getInstance();
            const resolved = registry.resolveByCapability('translation');

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

            const execResult = await executeTranslation(definition, executor, ticket, targetLang);

            if (!execResult.success) {
                throw new Error(execResult.error || 'Agent 翻译执行失败');
            }

            // 映射结果
            const translationData = mapTranslationResult(execResult.output, ticket, targetLang);

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
