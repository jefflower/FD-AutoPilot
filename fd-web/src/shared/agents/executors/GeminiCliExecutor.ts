import { tauriInvoke } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseAgentConfig } from '../schemaUtils';
import { extractJsonObject } from '../helpers/translationHelpers';

/** CLI 执行器内置默认值 */
const CLI_DEFAULTS = {
    invokeCommand: 'execute_gemini_cmd',
    models: ['gemini-2.5-flash'],
    timeout: 300,
};

/**
 * Gemini CLI 执行器
 *
 * 通过 Tauri invoke 调用本地 Gemini CLI 工具。
 * 提示词由服务端统一构造（resolvedPrompt），客户端只负责透传给 CLI 执行。
 */
export class GeminiCliExecutor implements AgentExecutor {
    readonly providerType = 'GEMINI_CLI' as const;
    readonly supportedCapability = 'gemini-cli';

    isAvailable(): boolean {
        return true;
    }

    getAvailableModels(): string[] {
        return ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        if (!this.isAvailable()) {
            return {
                success: false,
                output: null,
                durationMs: 0,
                error: `CLI Agent "${definition.name}" 仅在桌面客户端可用`,
            };
        }

        // 三级合并：CLI_DEFAULTS < definition.agentConfig < input.params（服务端 mergedConfig）
        const agentConfig = parseAgentConfig(definition.agentConfig);
        const mergedParams = input.params || {};
        const config: Record<string, any> = { ...CLI_DEFAULTS, ...agentConfig, ...mergedParams };
        const startTime = Date.now();

        try {
            const invokeCommand = config.invokeCommand || config.cliCommand;
            if (!invokeCommand) {
                throw new Error('CLI Agent 缺少 invokeCommand 或 cliCommand 配置');
            }

            // 服务端已解析的最终提示词
            const prompt = config.resolvedPrompt;
            if (!prompt) {
                throw new Error(`Agent "${definition.code}" 缺少 resolvedPrompt，请检查服务端是否正确下发`);
            }

            const models = Array.isArray(config.models)
                ? config.models
                : (config.model ? [config.model] : []);

            console.log(`[GeminiCliExecutor] ${invokeCommand}: agentCode=${definition.code}, prompt length=${prompt.length}, models=[${models.join(', ')}]`);

            const params: Record<string, any> = { prompt, agentCode: definition.code };
            if (models.length > 0) {
                params.models = models;
            }

            const result = await tauriInvoke(invokeCommand, params);
            return this.parseCliOutput(result, startTime);
        } catch (err: any) {
            return {
                success: false,
                output: null,
                durationMs: Date.now() - startTime,
                error: err?.message || String(err),
            };
        }
    }

    /** 解析 CLI 输出为结构化结果 */
    private parseCliOutput(rawOutput: any, startTime: number): AgentExecuteResult {
        if (typeof rawOutput === 'string') {
            try {
                const jsonStr = extractJsonObject(rawOutput);
                return {
                    success: true,
                    output: JSON.parse(jsonStr),
                    durationMs: Date.now() - startTime,
                };
            } catch (e) {
                // JSON 解析失败时仍返回 success + 原始文本，让下游有机会处理
                console.warn(`[GeminiCliExecutor] JSON 解析失败，返回原始文本: ${(e as Error).message}`);
                return {
                    success: true,
                    output: rawOutput,
                    durationMs: Date.now() - startTime,
                };
            }
        }
        return {
            success: true,
            output: rawOutput,
            durationMs: Date.now() - startTime,
        };
    }
}
