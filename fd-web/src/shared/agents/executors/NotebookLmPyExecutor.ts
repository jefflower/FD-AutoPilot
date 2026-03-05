import { tauriInvoke } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseAgentConfig, resolveTemplate } from '../schemaUtils';

/**
 * 通用 NotebookLM-py 执行器
 *
 * 通过 Tauri invoke 调用本地 notebooklm-py Python 库查询 NotebookLM 知识库。
 * 完全业务无关：从 systemPrompt 模板 + input.data 自动生成 query。
 *
 * 模板变量规则（与 GeminiCliExecutor 一致）：
 * - input.data 中的每个字段自动成为模板变量
 * - 对象类型 → JSON.stringify（如 {{ticket}}）
 * - 原始类型 → String（如 {{targetLang}}）
 *
 * notebookId 从 AgentDefinition.agentConfig 读取。
 */
export class NotebookLmPyExecutor implements AgentExecutor {
    readonly providerType = 'NOTEBOOKLM_PY' as const;
    readonly supportedCapability = 'notebooklm-py';

    isAvailable(): boolean {
        return true;
    }

    getAvailableModels(): string[] {
        return []; // NotebookLM 不需要模型选择
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        const agentConfig = parseAgentConfig(definition.agentConfig);
        const mergedParams = input.params || {};
        const config: Record<string, any> = { ...agentConfig, ...mergedParams };
        const startTime = Date.now();

        try {
            const invokeCommand = config.invokeCommand || 'execute_notebooklm_py_cmd';
            const notebookId = config.notebookId || '';

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

            // query 构建
            let query: string;
            if (systemPrompt) {
                query = resolveTemplate(systemPrompt, templateVars);
            } else if (data.query || data.prompt) {
                query = String(data.query || data.prompt);
            } else {
                return {
                    success: false,
                    output: null,
                    durationMs: 0,
                    error: 'NotebookLM-py Agent 缺少 systemPrompt 或 query 参数',
                };
            }

            console.log(`[NotebookLmPyExecutor] ${invokeCommand}: agentCode=${definition.code}, query length=${query.length}, notebookId=${notebookId ? notebookId.substring(0, 8) + '...' : '(default)'}, vars=[${Object.keys(templateVars).join(', ')}]`);

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
