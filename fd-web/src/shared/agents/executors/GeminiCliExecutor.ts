import { tauriInvoke } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseAgentConfig, resolveTemplate } from '../schemaUtils';
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
 * 完全业务无关：从 systemPrompt 模板 + input.data 自动生成 prompt。
 *
 * 模板变量规则：
 * - input.data 中的每个字段自动成为模板变量
 * - 对象类型 → JSON.stringify（如 {{ticket}}）
 * - 原始类型 → String（如 {{targetLang}}）
 * - systemPrompt 中用 {{fieldName}} 引用
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

            // systemPrompt 优先级：mergedConfig > definition 独立字段 > agentConfig
            const effectiveDefinition = mergedParams.systemPrompt
                ? { ...definition, systemPrompt: mergedParams.systemPrompt }
                : definition;

            const cliData = this.buildCliParams(effectiveDefinition, config, input.data || {});
            const result = await tauriInvoke(invokeCommand, cliData);
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

    /**
     * 构建 CLI 参数：{ prompt, models, agentCode }
     *
     * 通用逻辑：自动从 input.data 的字段名生成模板变量，
     * systemPrompt 中用 {{fieldName}} 引用即可。
     */
    private buildCliParams(definition: AgentDefinition, config: Record<string, any>, data: any): Record<string, any> {
        const systemPrompt = definition.systemPrompt || config.systemPrompt || '';

        // 通用模板变量：input.data 字段名 → 模板变量名，业务无关
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

        const resolvedPrompt = resolveTemplate(systemPrompt, templateVars);

        const models = Array.isArray(config.models)
            ? config.models
            : (config.model ? [config.model] : []);

        console.log(`[GeminiCliExecutor] ${config.invokeCommand}: agentCode=${definition.code}, prompt length=${resolvedPrompt.length}, models=[${models.join(', ')}], vars=[${Object.keys(templateVars).join(', ')}]`);

        const params: Record<string, any> = { prompt: resolvedPrompt, agentCode: definition.code };
        if (models.length > 0) {
            params.models = models;
        }
        return params;
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
