import { tauriInvoke } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseAgentConfig, resolveTemplate } from '../schemaUtils';

/** Claude CLI 执行器内置默认值 */
const CLI_DEFAULTS = {
    invokeCommand: 'execute_claude_cmd',
    models: ['claude-sonnet-4-20250514'],
};

/**
 * Claude CLI 执行器
 *
 * 通过 Tauri invoke 调用本地 Claude CLI 工具。
 * 完全业务无关：从 systemPrompt 模板 + input.data 自动生成 prompt。
 *
 * 模板变量规则（与 GeminiCliExecutor 一致）：
 * - input.data 中的每个字段自动成为模板变量
 * - 对象类型 → JSON.stringify（如 {{ticket}}）
 * - 原始类型 → String（如 {{targetLang}}）
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

            // systemPrompt 优先级：mergedConfig > definition 独立字段 > agentConfig
            const systemPrompt = mergedParams.systemPrompt || definition.systemPrompt || config.systemPrompt || '';

            // 通用模板变量：input.data 字段名 → 模板变量名
            const data = input.data || {};
            const templateVars: Record<string, string> = {};
            for (const [key, value] of Object.entries(data)) {
                if (value === null || value === undefined) {
                    templateVars[key] = '';
                } else if (typeof value === 'object') {
                    templateVars[key] = JSON.stringify(value, null, 2);
                } else {
                    templateVars[key] = String(value);
                }
            }

            // prompt 构建
            let prompt: string;
            if (systemPrompt) {
                prompt = resolveTemplate(systemPrompt, templateVars);
            } else if (data.prompt) {
                prompt = String(data.prompt);
            } else if (data.query) {
                prompt = String(data.query);
            } else {
                return {
                    success: false,
                    output: null,
                    durationMs: 0,
                    error: 'Claude CLI Agent 缺少 systemPrompt 或 prompt 参数',
                };
            }

            // models 合并：CLI_DEFAULTS < agentConfig < mergedConfig
            const models = Array.isArray(config.models)
                ? config.models
                : (config.model ? [config.model] : []);

            console.log(`[ClaudeCliExecutor] ${invokeCommand}: agentCode=${definition.code}, prompt length=${prompt.length}, models=[${models.join(', ')}], vars=[${Object.keys(templateVars).join(', ')}]`);

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
