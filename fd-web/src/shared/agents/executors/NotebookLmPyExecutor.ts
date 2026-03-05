import { tauriInvoke } from '../../../tauri/bridge';
import type { SkillInfo } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseAgentConfig } from '../schemaUtils';

/**
 * 通用 NotebookLM-py 执行器
 *
 * 通过 Tauri invoke 调用本地 notebooklm-py Python 库查询 NotebookLM 知识库。
 * 提示词由服务端统一构造（resolvedPrompt），客户端只负责透传给 CLI 执行。
 *
 * notebookId 从 AgentDefinition.agentConfig 或 mergedConfig 读取。
 */
export class NotebookLmPyExecutor implements AgentExecutor {
    readonly providerType = 'NOTEBOOKLM_PY' as const;
    readonly supportedCapability = 'notebooklm-py';

    isAvailable(): boolean {
        return true;
    }

    async getAvailableModels(): Promise<string[]> {
        return []; // NotebookLM 不需要模型选择
    }

    async detectSkills(): Promise<SkillInfo[]> {
        return []; // NotebookLM 不支持 skill 探测
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        const agentConfig = parseAgentConfig(definition.agentConfig);
        const mergedParams = input.params || {};
        const config: Record<string, any> = { ...agentConfig, ...mergedParams };
        const startTime = Date.now();

        try {
            const invokeCommand = config.invokeCommand || 'execute_notebooklm_py_cmd';
            const notebookId = config.notebookId || '';

            // 服务端已解析的最终提示词
            const query = config.resolvedPrompt;
            if (!query) {
                throw new Error(`Agent "${definition.code}" 缺少 resolvedPrompt，请检查服务端是否正确下发`);
            }

            console.log(`[NotebookLmPyExecutor] ${invokeCommand}: agentCode=${definition.code}, query length=${query.length}, notebookId=${notebookId ? notebookId.substring(0, 8) + '...' : '(default)'}`);

            const result = await tauriInvoke<string>(invokeCommand, {
                query,
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
