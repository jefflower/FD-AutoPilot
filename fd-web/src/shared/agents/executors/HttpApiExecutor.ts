import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';

/**
 * HTTP_API 执行器
 *
 * 通过服务端代理执行 HTTP API 调用（如 OpenAI/Claude API）。
 * 前端不直接调用外部 API（API Key 在服务端），
 * 而是通过 POST /api/v1/agents/execute/{code} 让服务端执行。
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
            const result = await agentApi.executeAgent(definition.code, {
                input: typeof input.data === 'string' ? input.data : JSON.stringify(input.data),
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
