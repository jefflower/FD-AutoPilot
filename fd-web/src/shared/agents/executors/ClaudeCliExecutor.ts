import { tauriInvoke } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseAgentConfig } from '../schemaUtils';

/** Claude CLI 执行器内置默认值 */
const CLI_DEFAULTS = {
    invokeCommand: 'execute_claude_cmd',
    models: ['claude-sonnet-4-20250514'],
};

/**
 * Claude CLI 执行器
 *
 * 通过 Tauri invoke 调用本地 Claude CLI 工具。
 * 提示词由服务端统一构造（resolvedPrompt），客户端只负责透传给 CLI 执行。
 */
export class ClaudeCliExecutor implements AgentExecutor {
    readonly providerType = 'CLAUDE_CLI' as const;
    readonly supportedCapability = 'claude-cli';

    isAvailable(): boolean {
        return true;
    }

    getAvailableModels(): string[] {
        return ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-20250514'];
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        // 三级合并：CLI_DEFAULTS < definition.agentConfig < input.params（服务端 mergedConfig）
        const agentConfig = parseAgentConfig(definition.agentConfig);
        const mergedParams = input.params || {};
        const config: Record<string, any> = { ...CLI_DEFAULTS, ...agentConfig, ...mergedParams };
        const startTime = Date.now();

        try {
            const invokeCommand = config.invokeCommand;

            // 服务端已解析的最终提示词
            const prompt = config.resolvedPrompt;
            if (!prompt) {
                throw new Error(`Agent "${definition.code}" 缺少 resolvedPrompt，请检查服务端是否正确下发`);
            }

            // models 合并
            const models = Array.isArray(config.models)
                ? config.models
                : (config.model ? [config.model] : []);

            console.log(`[ClaudeCliExecutor] ${invokeCommand}: agentCode=${definition.code}, prompt length=${prompt.length}, models=[${models.join(', ')}]`);

            const cliParams: Record<string, any> = { prompt, agentCode: definition.code };
            if (models.length > 0) {
                cliParams.models = models;
            }

            const result = await tauriInvoke<string>(invokeCommand, cliParams);

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
