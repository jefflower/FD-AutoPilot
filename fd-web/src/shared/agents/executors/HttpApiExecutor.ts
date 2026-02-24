import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { buildHttpApiPrompt, langCodeToName } from '../helpers/translationHelpers';

/**
 * HTTP_API 执行器
 *
 * 通过服务端代理执行 HTTP API 调用（如 OpenAI/Claude API）。
 * 前端不直接调用外部 API（API Key 在服务端），
 * 而是通过 POST /api/v1/agents/execute/{code} 让服务端执行。
 *
 * 支持两条执行路径：
 * - 新路径（标准化输入）：当 definition.inputSchema 存在且 input.data 包含 ticket 时，
 *   自动构建结构化 prompt
 * - 旧路径（直接传参）：将 input.data 序列化为字符串传给服务端
 */
export class HttpApiExecutor implements AgentExecutor {
    readonly providerType = 'HTTP_API' as const;

    isAvailable(): boolean {
        return true;
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        const startTime = Date.now();

        try {
            // 动态导入避免循环依赖
            const { agentApi } = await import('../../services/serverApi');

            let requestInput: string;

            // 新路径：标准化输入 -> 自动构建 prompt
            if (definition.inputSchema && input.data?.ticket) {
                const targetLang = input.data.targetLang || 'en';
                requestInput = buildHttpApiPrompt(input.data.ticket, langCodeToName(targetLang));
                console.log(`[HttpApiExecutor] Standard path: prompt length=${requestInput.length}`);
            } else {
                // 旧路径：保持原有逻辑
                requestInput = typeof input.data === 'string' ? input.data : JSON.stringify(input.data);
            }

            const result = await agentApi.executeAgent(definition.code, {
                input: requestInput,
                referenceType: input.referenceType,
                referenceId: input.referenceId,
            });

            let output = result.output;
            try {
                output = JSON.parse(result.output);
            } catch { /* 保持字符串 */ }

            return {
                success: result.success,
                output,
                durationMs: Date.now() - startTime,
                tokenCount: result.tokenCount ?? undefined,
                error: result.errorMessage ?? undefined,
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
