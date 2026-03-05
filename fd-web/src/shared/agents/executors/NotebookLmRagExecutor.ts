import { tauriInvoke } from '../../../tauri/bridge';
import type { SkillInfo } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseAgentConfig } from '../schemaUtils';

/**
 * NotebookLM RAG 模式执行器
 *
 * 将工单内容作为临时 source 添加到 NotebookLM 知识库，提问后自动清理。
 * 适用于超过 6000 字符的长内容工单，解决 notebooklm-py 聊天 API 的长度限制。
 *
 * 流程: 写临时文件 → source add → source wait → ask → source delete → 清理
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

            // 指令（resolvedPrompt，不含工单内容）
            const query = config.resolvedPrompt;
            if (!query) {
                throw new Error(`Agent "${definition.code}" 缺少 resolvedPrompt，请检查服务端是否正确下发`);
            }

            // 工单原文（作为临时 source 添加）
            const sourceContent = config.ticketContent || config.sourceContent;
            if (!sourceContent) {
                throw new Error(`Agent "${definition.code}" 缺少 ticketContent/sourceContent，无法使用 RAG 模式`);
            }

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
            return {
                success: false,
                output: null,
                durationMs: Date.now() - startTime,
                error: err?.message || String(err),
            };
        }
    }
}
