import { isTauriEnv } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult, AgentStreamChunk } from '../../types/server';
import { parseProviderConfig } from '../schemaUtils';

/**
 * WEB_AUTOMATION 执行器
 *
 * 通过 Tauri Shadow Window 与在线工具交互（如 NotebookLM、17track）。
 * 仅在 Tauri 桌面环境下可用。支持流式输出（executeStream）。
 *
 * 双路径执行：
 * - 新路径（标准化）：当 definition.inputSchema 存在且 input.data.ticket 有值时，
 *   根据 definition.capability 自动分发到 handleReply 或 handleTracking，
 *   内化了消息构建、Shadow Window 调用和结果解析。
 * - 旧路径（兼容）：通过 input.params.shadowHandler 传入外部处理函数。
 */
export class ShadowExecutor implements AgentExecutor {
    readonly providerType = 'WEB_AUTOMATION' as const;

    isAvailable(): boolean {
        return isTauriEnv();
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        if (!this.isAvailable()) {
            return {
                success: false,
                output: null,
                durationMs: 0,
                error: `Shadow Window Agent "${definition.name}" 仅在桌面客户端可用`,
            };
        }

        const startTime = Date.now();

        try {
            let fullText = '';
            let parsedOutput: Record<string, any> | undefined;
            for await (const chunk of this.executeStream!(definition, input)) {
                if (chunk.status === 'error') {
                    return {
                        success: false,
                        output: null,
                        durationMs: Date.now() - startTime,
                        error: chunk.text,
                    };
                }
                fullText = chunk.text;
                if (chunk.parsedOutput) parsedOutput = chunk.parsedOutput;
            }

            return {
                success: true,
                output: parsedOutput || fullText,
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

    async *executeStream(definition: AgentDefinition, input: AgentExecuteInput): AsyncGenerator<AgentStreamChunk> {
        if (!this.isAvailable()) {
            yield { text: `Shadow Window Agent "${definition.name}" 仅在桌面客户端可用`, status: 'error' };
            return;
        }

        // 新路径：标准化输入（有 inputSchema 且有 ticket 数据）
        if (definition.inputSchema && input.data?.ticket) {
            yield* this.executeStandardized(definition, input);
            return;
        }

        // 旧路径：shadowHandler 函数注入
        const shadowHandler = input.params?.shadowHandler as
            | ((def: AgentDefinition, inp: AgentExecuteInput) => AsyncGenerator<AgentStreamChunk>)
            | undefined;

        if (!shadowHandler) {
            yield { text: 'Shadow Window Agent 缺少 shadowHandler 参数', status: 'error' };
            return;
        }

        try {
            for await (const chunk of shadowHandler(definition, input)) {
                yield {
                    text: chunk.text,
                    status: chunk.status as AgentStreamChunk['status'],
                };
            }
        } catch (err: any) {
            yield { text: err?.message || String(err), status: 'error' };
        }
    }

    /** 新路径：根据 capability 自动选择处理策略 */
    private async *executeStandardized(
        def: AgentDefinition,
        input: AgentExecuteInput
    ): AsyncGenerator<AgentStreamChunk> {
        const config = parseProviderConfig(def.providerConfig);
        const capability = def.capability;

        switch (capability) {
            case 'reply':
                yield* this.handleReply(config, input);
                break;
            case 'tracking':
                yield* this.handleTracking(config, input);
                break;
            default:
                yield { text: `不支持的 Shadow Window capability: ${capability}`, status: 'error' };
        }
    }

    /** 回复 Agent -- 内化 buildReplyContext + buildReplyMessages + NotebookShadowService */
    private async *handleReply(
        config: Record<string, any>,
        input: AgentExecuteInput
    ): AsyncGenerator<AgentStreamChunk> {
        // 动态导入避免 Web 环境报错
        const { NotebookShadowService } = await import('../../../tauri/services/notebookShadow');
        const { buildReplyContext, buildReplyMessages, parseReplyOutput } = await import('../helpers/replyHelpers');

        const ticket = input.data.ticket;
        const notebookId = config.notebookId;
        const notebookUrl = config.notebookUrl;
        const promptTemplate = config.prompt || '请根据以下工单内容回答我的问题:\n\n${工单内容}';
        const lastAuditRemark = input.data.lastAuditRemark;

        if (!notebookId) {
            yield { text: '缺少 notebookId 配置', status: 'error' };
            return;
        }

        // 构建上下文（注入审核反馈，物流信息由调用方通过 trackingContext 传入）
        const context = buildReplyContext(ticket, lastAuditRemark, {
            trackingContext: input.data.trackingContext,
        });

        // 构建消息（处理分段）
        const messages = buildReplyMessages(context, promptTemplate);
        console.log(`[ShadowExecutor] handleReply: messages=${messages.length}, context length=${context.length}`);

        const shadowService = new NotebookShadowService(notebookId, notebookUrl);

        try {
            const generator = messages.length === 1
                ? shadowService.query(messages[0])
                : shadowService.queryMultiRound(messages);

            for await (const chunk of generator) {
                if (chunk.status === 'complete') {
                    const parsed = parseReplyOutput(chunk.text);
                    yield {
                        text: chunk.text,
                        status: 'complete',
                        parsedOutput: parsed ? parsed : undefined,
                    };
                } else {
                    yield { text: chunk.text, status: chunk.status as AgentStreamChunk['status'] };
                }
            }
        } catch (err: any) {
            yield { text: err?.message || String(err), status: 'error' };
        }
    }

    /** 物流查询 Agent */
    private async *handleTracking(
        _config: Record<string, any>,
        input: AgentExecuteInput
    ): AsyncGenerator<AgentStreamChunk> {
        const { TrackingShadowService } = await import('../../../tauri/services/trackingShadow');
        const trackingNumbers: string[] = input.data.trackingNumbers || [];

        if (trackingNumbers.length === 0) {
            yield { text: '缺少物流单号', status: 'error' };
            return;
        }

        try {
            const service = new TrackingShadowService();
            const results = await service.queryMultiple(trackingNumbers.slice(0, 3));
            yield {
                text: JSON.stringify(results, null, 2),
                status: 'complete',
                parsedOutput: { results },
            };
        } catch (err: any) {
            yield { text: err?.message || String(err), status: 'error' };
        }
    }
}
