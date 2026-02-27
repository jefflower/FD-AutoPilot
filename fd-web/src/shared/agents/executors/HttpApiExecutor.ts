import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult, AgentStreamChunk } from '../../types/server';
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
 *   根据 capability 自动构建结构化 prompt（翻译或回复）
 * - 旧路径（直接传参）：将 input.data 序列化为字符串传给服务端
 *
 * executeStream：将同步 execute() 结果包装为单次完整 chunk 的异步生成器，
 * 使 reply capability 在浏览器模式下可用（useAiReply 要求 executeStream）。
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

            const requestInput = await this.buildRequestInput(definition, input);

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

    /**
     * 流式执行：包装 execute() 结果为异步生成器。
     * reply capability 需要此方法（useAiReply 依赖 executeStream）。
     */
    async *executeStream(definition: AgentDefinition, input: AgentExecuteInput): AsyncGenerator<AgentStreamChunk> {
        // 先 yield streaming 状态让 UI 展示加载指示
        yield { text: '正在通过 HTTP API 生成回复...', status: 'streaming' };

        const result = await this.execute(definition, input);

        if (!result.success) {
            yield { text: result.error || 'HTTP API 执行失败', status: 'error' };
            return;
        }

        // 尝试将输出解析为 reply 格式（targetReply + zhReply）
        const parsedOutput = this.tryParseReplyOutput(result.output, definition.capability);

        yield {
            text: typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
            status: 'complete',
            parsedOutput: parsedOutput || undefined,
        };
    }

    /** 根据 capability 构建请求输入 */
    private async buildRequestInput(definition: AgentDefinition, input: AgentExecuteInput): Promise<string> {
        // 标准化路径：有 inputSchema 且有 ticket 数据
        if (definition.inputSchema && input.data?.ticket) {
            const capability = definition.capability;

            if (capability === 'reply') {
                return this.buildReplyPrompt(definition, input);
            }

            // 翻译（默认）
            const targetLang = input.data.targetLang || 'en';
            const prompt = buildHttpApiPrompt(input.data.ticket, langCodeToName(targetLang));
            console.log(`[HttpApiExecutor] Translation standard path: prompt length=${prompt.length}`);
            return prompt;
        }

        // 旧路径：保持原有逻辑
        return typeof input.data === 'string' ? input.data : JSON.stringify(input.data);
    }

    /** 为 reply capability 构建 prompt */
    private buildReplyPrompt(definition: AgentDefinition, input: AgentExecuteInput): string {
        // 动态导入 replyHelpers（避免顶层循环依赖）
        // 由于 import() 是异步的，这里同步构建 prompt
        const ticket = input.data.ticket;
        const lastAuditRemark = input.data.lastAuditRemark;

        let parsedData: any = {};
        try { parsedData = JSON.parse(ticket.content || '{}'); } catch { /* ignore */ }

        let context = `【TICKET SUBJECT】: ${ticket.subject}\n`;
        context += `【INITIAL DESCRIPTION】: ${parsedData?.description || 'No description content'}\n\n`;

        if (parsedData?.conversations?.length > 0) {
            context += '【DETAILED INTERACTION LOGS】:\n';
            for (const conv of parsedData.conversations) {
                const role = conv.incoming ? 'CUSTOMER' : 'AGENT';
                const timeStr = conv.createdAt || 'Unknown Time';
                const bodyText = conv.bodyText || '';
                context += `[${timeStr}] <${role}>:\n${bodyText}\n--------------------------------------------------\n`;
            }
        }

        if (lastAuditRemark) {
            context += `\n【PREVIOUS AUDIT FEEDBACK】:\n审核意见: ${lastAuditRemark}\n请根据以上审核反馈改进你的回复，避免重复之前的问题。\n\n`;
        }

        // 从 providerConfig 读取 prompt 模板，fallback 到默认模板
        const config = typeof definition.providerConfig === 'string'
            ? (() => { try { return JSON.parse(definition.providerConfig); } catch { return {}; } })()
            : (definition.providerConfig || {});
        const promptTemplate = config.prompt || config.systemPrompt
            || '请根据以下工单内容生成回复，返回格式为 JSON：{"targetReply": "英文回复", "zhReply": "中文回复"}';

        const prompt = `${promptTemplate}\n\n${context}`;
        console.log(`[HttpApiExecutor] Reply standard path: prompt length=${prompt.length}`);
        return prompt;
    }

    /** 尝试将输出解析为回复格式 */
    private tryParseReplyOutput(output: any, capability: string): Record<string, any> | null {
        if (capability !== 'reply') return null;

        // 输出已经是对象且包含 targetReply/zhReply
        if (output && typeof output === 'object' && output.targetReply && output.zhReply) {
            return output;
        }

        // 输出是字符串，尝试 JSON 解析
        if (typeof output === 'string') {
            try {
                const parsed = JSON.parse(output);
                if (parsed.targetReply && parsed.zhReply) return parsed;
            } catch { /* ignore */ }

            // 尝试从文本中提取 JSON
            try {
                const start = output.indexOf('{');
                const end = output.lastIndexOf('}');
                if (start !== -1 && end > start) {
                    const jsonStr = output.substring(start, end + 1);
                    const parsed = JSON.parse(jsonStr);
                    if (parsed.targetReply && parsed.zhReply) return parsed;
                }
            } catch { /* ignore */ }

            // Fallback: 尝试按 "---" 或换行分隔的双段文本格式
            const segments = output.split(/\n---+\n|\n{2,}/);
            if (segments.length >= 2) {
                const targetReply = segments[0].trim();
                const zhReply = segments[1].trim();
                if (targetReply && zhReply) return { targetReply, zhReply };
            }
        }

        return null;
    }
}
