import { tauriInvoke } from '../../../tauri/bridge';
import type { SkillInfo } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseAgentConfig } from '../schemaUtils';

/** 默认 RAG query — 让 NotebookLM 按照文档中的指令完成任务 */
const DEFAULT_RAG_QUERY = '请仔细阅读上传的文档，严格按照其中的指令要求完成任务并输出结果。直接输出最终结果，不要添加额外说明。';

/**
 * NotebookLM RAG 模式执行器
 *
 * 将完整提示词（resolvedPrompt）作为临时 source 添加到 NotebookLM 知识库，
 * 用通用 query 指令提问后自动清理 source。
 *
 * 适用于任何提示词过长导致 NotebookLM 聊天 API 返回空结果的场景（通常 > 6000 字符）。
 * 不限于工单场景——任何 Agent 只要绑定 notebooklm-rag 能力即可使用。
 *
 * 流程: 写临时文件("待处理问题.txt") → source add → source wait → ask → source delete → 清理
 */
export class NotebookLmRagExecutor implements AgentExecutor {
    readonly providerType = 'NOTEBOOKLM_RAG' as const;
    readonly supportedCapability = 'notebooklm-rag';

    isAvailable(): boolean {
        return true;
    }

    async getAvailableModels(): Promise<string[]> {
        return []; // NotebookLM RAG 不需要模型选择
    }

    async detectSkills(): Promise<SkillInfo[]> {
        return []; // NotebookLM RAG 不支持 skill 探测
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        const agentConfig = parseAgentConfig(definition.agentConfig);
        const mergedParams = input.params || {};
        const config: Record<string, any> = { ...agentConfig, ...mergedParams };
        const startTime = Date.now();

        try {
            const invokeCommand = config.invokeCommand || 'execute_notebooklm_rag_cmd';
            const notebookId = config.notebookId;

            if (!notebookId) {
                throw new Error(`notebookId 未配置，无法执行。请在「我的 Agent」中配置 Notebook ID`);
            }

            // resolvedPrompt 包含完整内容（指令 + 数据），作为 source 上传
            const sourceContent = config.resolvedPrompt;
            if (!sourceContent) {
                throw new Error(`Agent "${definition.code}" 缺少 resolvedPrompt，请检查服务端是否正确下发`);
            }

            // query 使用通用指令（可通过 agentConfig.ragQuery 自定义）
            const query = config.ragQuery || DEFAULT_RAG_QUERY;

            console.log(`[NotebookLmRagExecutor] ${invokeCommand}: agentCode=${definition.code}, query length=${query.length}, source length=${sourceContent.length}, notebookId=${notebookId.substring(0, 8)}...`);

            const result = await tauriInvoke<string>(invokeCommand, {
                query,
                sourceContent,
                notebookId,
                agentCode: definition.code,
            });

            return {
                success: true,
                output: result,
                durationMs: Date.now() - startTime,
            };
        } catch (err: any) {
            const rawMsg = err?.message || String(err);
            // 增强错误信息，帮助定位根因
            let enhancedMsg = rawMsg;
            if (rawMsg.includes('Failed to fetch') || rawMsg.includes('Bridge fetch 失败')) {
                const sourceLen = config.resolvedPrompt?.length || 0;
                enhancedMsg =
                    `[NotebookLmRagExecutor] Bridge 调用失败 (agentCode=${definition.code}, ` +
                    `sourceContent=${sourceLen} 字符)。` +
                    (sourceLen > 2 * 1024 * 1024
                        ? ` sourceContent 超过 2MB (${Math.round(sourceLen / 1024)}KB)，可能触发 Axum body size 限制。`
                        : '') +
                    ` 原始错误: ${rawMsg}`;
            } else if (rawMsg.includes('超时')) {
                enhancedMsg =
                    `[NotebookLmRagExecutor] 执行超时 (agentCode=${definition.code})。` +
                    `NotebookLM RAG 操作包含上传 source、等待处理、提问、清理等步骤，耗时较长。` +
                    ` 原始错误: ${rawMsg}`;
            }
            console.error(`[NotebookLmRagExecutor] ${enhancedMsg}`);
            return {
                success: false,
                output: null,
                durationMs: Date.now() - startTime,
                error: enhancedMsg,
            };
        }
    }
}
