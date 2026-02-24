import { isTauriEnv, tauriInvoke } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseProviderConfig, resolveTemplate } from '../schemaUtils';
import { langCodeToName, formatTicketContent, extractJsonObject } from '../helpers/translationHelpers';

/**
 * GEMINI_CLI 执行器
 *
 * 通过 Tauri invoke 调用本地 CLI 工具（如 Gemini CLI）。
 * 仅在 Tauri 桌面环境下可用。
 *
 * 支持两条执行路径：
 * - 新路径（标准化输入）：当 definition.inputSchema 存在且 input.data 包含 ticket 时，
 *   自动根据 providerConfig 中的 systemPrompt 构建 CLI 参数
 * - 旧路径（直接传参）：兼容现有 useAiTranslation 中的直接调用方式
 */
export class CliExecutor implements AgentExecutor {
    readonly providerType = 'GEMINI_CLI' as const;

    isAvailable(): boolean {
        return isTauriEnv();
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

        const config = parseProviderConfig(definition.providerConfig);
        const startTime = Date.now();

        try {
            const invokeCommand = config.invokeCommand || config.cliCommand;
            if (!invokeCommand) {
                throw new Error('CLI Agent 缺少 invokeCommand 或 cliCommand 配置');
            }

            // 新路径：标准化输入（有 inputSchema 且 input.data 包含 ticket）
            if (definition.inputSchema && input.data?.ticket) {
                const cliData = this.buildCliInput(definition, config, input.data);
                const result = await tauriInvoke(invokeCommand, cliData);
                return this.parseCliOutput(result, startTime);
            }

            // 旧路径：直接传参（兼容现有 useAiTranslation 逻辑）
            const result = await tauriInvoke(invokeCommand, {
                ...input.data,
                ...(input.params || {}),
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

    /** 根据 providerConfig 中的 systemPrompt + 标准输入构建 CLI 参数 */
    private buildCliInput(_def: AgentDefinition, config: Record<string, any>, data: any): Record<string, any> {
        const systemPrompt = config.systemPrompt || '';
        const langName = langCodeToName(data.targetLang || 'cn');
        const ticketContent = formatTicketContent(data.ticket);

        const resolvedPrompt = resolveTemplate(systemPrompt, {
            TARGET_LANG: langName,
            TICKET_CONTENT: ticketContent,
        });

        const models = Array.isArray(config.models)
            ? config.models
            : (config.model ? [config.model] : []);

        console.log(`[CliExecutor] Standard path: prompt length=${resolvedPrompt.length}, models=[${models.join(', ')}]`);

        return { prompt: resolvedPrompt, models };
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
                return {
                    success: false,
                    output: null,
                    durationMs: Date.now() - startTime,
                    error: `翻译结果 JSON 解析失败: ${(e as Error).message}`,
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
