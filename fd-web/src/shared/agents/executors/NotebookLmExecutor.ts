import { isTauriEnv, checkBridgeAvailable } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult, AgentStreamChunk } from '../../types/server';
import { parseAgentConfig } from '../schemaUtils';

/** NotebookLM 执行器内置默认值，前端不再依赖 agentConfig 传入这些字段 */
const NOTEBOOKLM_DEFAULTS = {
    windowLabel: 'notebook_shadow',
    selectors: {
        INPUT: 'textarea.query-box-input',
        CHAT_PAIR: '.chat-message-pair',
        CHAT_PAIR_ALT: '[role="log"] .message-content',
        BOT_REPLY: '.to-user-container .message-text-content',
        BOT_REPLY_FALLBACK_1: '.model-response-text',
        BOT_REPLY_FALLBACK_2: '.response-container',
        COPY_BUTTON: '.xap-copy-to-clipboard',
        SEND_BUTTON: 'button.submit-button:not([disabled])',
        MENU_BUTTON: 'button[aria-label="对话选项"]',
        CONFIRM_DELETE: 'button.yes-button',
    },
    timeouts: {
        pageLoadMs: 3000,
        clearMaxMs: 15000,
        ackTimeoutMs: 30000,
        noResponseTimeoutMs: 60000,
        silenceTimeoutMs: 30000,
        totalTimeoutCycles: 240,
        relayIntervalMs: 500,
        interMessageDelayMs: 1000,
        finishedConfirmMs: 3000,
    },
    clearConfig: {
        enabled: true,
        maxRetries: 3,
        waitAfterDeleteMs: 2500,
    },
};

/**
 * NotebookLM 执行器
 *
 * 通过 Tauri Shadow Window 与 NotebookLM 交互生成工单回复。
 * 支持流式输出（executeStream）。
 *
 * 统一使用 Bridge SSE 路径（Rust 后端控制 Shadow Window），
 * 仅在 Bridge 不可用且为 Tauri 桌面模式时降级为前端 JS 直连。
 */
export class NotebookLmExecutor implements AgentExecutor {
    readonly providerType = 'NOTEBOOKLM' as const;

    isAvailable(): boolean {
        return true;
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
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
        const userConfig = parseAgentConfig(definition.agentConfig);
        // 深合并（嵌套对象如 selectors 需要合并而不是覆盖）
        const config: Record<string, any> = {
            ...NOTEBOOKLM_DEFAULTS,
            ...userConfig,
            selectors: { ...NOTEBOOKLM_DEFAULTS.selectors, ...(userConfig.selectors || {}) },
            timeouts: { ...NOTEBOOKLM_DEFAULTS.timeouts, ...(userConfig.timeouts || {}) },
            clearConfig: { ...NOTEBOOKLM_DEFAULTS.clearConfig, ...(userConfig.clearConfig || {}) },
        };

        const { buildReplyContext, buildReplyMessages, parseReplyOutput } = await import('../helpers/replyHelpers');

        const ticket = input.data.ticket;
        const notebookId = config.notebookId;
        // 优先从独立字段读取，兼容旧的 agentConfig 内读取
        const promptTemplate = definition.systemPrompt || config.systemPrompt || config.prompt || '请根据以下工单内容回答我的问题:\n\n${工单内容}';
        const lastAuditRemark = input.data.lastAuditRemark;

        if (!notebookId) {
            yield { text: '缺少 notebookId 配置', status: 'error' };
            return;
        }

        // 物流查询（仅 Tauri 环境支持直接查询）
        let trackingContext = input.data.trackingContext as string | undefined;
        if (!trackingContext && isTauriEnv()) {
            const trackingNumbers = input.data.trackingNumbers as string[] | undefined;
            if (trackingNumbers && trackingNumbers.length > 0) {
                try {
                    const { TrackingShadowService } = await import('../../../tauri/services/trackingShadow');
                    const { formatTrackingContext } = await import('../../utils/trackingUtils');
                    const trackingService = new TrackingShadowService({
                        targetUrl: config.trackingTargetUrl,
                        extractionConfig: config.trackingExtractionConfig,
                    });
                    const maxNumbers = config.trackingExtractionConfig?.maxNumbers ?? 3;
                    const results = await trackingService.queryMultiple(trackingNumbers.slice(0, maxNumbers));
                    trackingContext = formatTrackingContext(results) || undefined;
                    console.log(`[NotebookLmExecutor] queried ${trackingNumbers.length} tracking number(s), context length=${trackingContext?.length || 0}`);
                } catch (e) {
                    console.warn('[NotebookLmExecutor] tracking query failed, continuing without:', e);
                }
            }
        }

        // 构建上下文（注入审核反馈 + 物流信息）
        const context = buildReplyContext(ticket, lastAuditRemark, {
            trackingContext,
        });

        // 构建消息（处理分段）
        const messages = buildReplyMessages(context, promptTemplate);
        console.log(`[NotebookLmExecutor] messages=${messages.length}, context length=${context.length}`);

        // 统一优先使用 Bridge SSE（Rust 后端控制 Shadow Window）
        const bridgeOk = await checkBridgeAvailable();
        if (bridgeOk) {
            console.log('[NotebookLmExecutor] 使用 Bridge SSE 路径');
            yield* this.handleReplyBridge(config, messages, parseReplyOutput);
        } else if (isTauriEnv()) {
            console.warn('[NotebookLmExecutor] Bridge 不可用，降级为 Tauri 直连路径');
            yield* this.handleReplyTauri(config, messages, parseReplyOutput);
        } else {
            yield {
                text: 'Shadow Agent 需要 fd-client (Tauri) 后台运行。请启动: npm run tauri dev (在 fd-client 目录)',
                status: 'error',
            };
            return;
        }
    }

    /** Tauri 直连路径 */
    private async *handleReplyTauri(
        config: Record<string, any>,
        messages: string[],
        parseReplyOutput: (text: string) => { targetReply: string; zhReply: string } | null,
    ): AsyncGenerator<AgentStreamChunk> {
        const { NotebookShadowService } = await import('../../../tauri/services/notebookShadow');

        const shadowService = new NotebookShadowService(config.notebookId, config.notebookUrl, {
            selectors: config.selectors,
            timeouts: config.timeouts,
            clearConfig: config.clearConfig,
        });

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

    /** 浏览器 SSE 路径：通过 bridge server 调用 Rust Shadow Agent */
    private async *handleReplyBridge(
        config: Record<string, any>,
        messages: string[],
        parseReplyOutput: (text: string) => { targetReply: string; zhReply: string } | null,
    ): AsyncGenerator<AgentStreamChunk> {
        const bridgeOk = await checkBridgeAvailable();
        if (!bridgeOk) {
            yield {
                text: 'Shadow Agent 需要 fd-client (Tauri) 后台运行。请启动: npm run tauri dev (在 fd-client 目录)',
                status: 'error',
            };
            return;
        }

        const reqBody = {
            notebookId: config.notebookId,
            notebookUrl: config.notebookUrl,
            messages,
            selectors: config.selectors,
            timeouts: config.timeouts,
            clearConfig: config.clearConfig,
        };

        try {
            const resp = await fetch('/bridge/agents/reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody),
            });

            if (!resp.ok) {
                yield { text: `Bridge SSE 请求失败: ${resp.status} ${resp.statusText}`, status: 'error' };
                return;
            }

            const reader = resp.body?.getReader();
            if (!reader) {
                yield { text: 'SSE 响应无 body', status: 'error' };
                return;
            }

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                let currentEventType = '';
                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        currentEventType = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        try {
                            const parsed = JSON.parse(data);
                            const eventType = parsed.type || currentEventType;

                            if (eventType === 'complete') {
                                const text = parsed.text || '';
                                const replyParsed = parseReplyOutput(text);
                                yield {
                                    text,
                                    status: 'complete',
                                    parsedOutput: replyParsed ? replyParsed : undefined,
                                };
                                reader.cancel();
                                return;
                            } else if (eventType === 'error') {
                                yield { text: parsed.message || 'Unknown error', status: 'error' };
                                reader.cancel();
                                return;
                            } else if (eventType === 'streaming') {
                                yield { text: parsed.text || '', status: 'streaming' };
                            } else if (eventType === 'log') {
                                console.log(`[NotebookLmExecutor-Bridge] ${parsed.message}`);
                            }
                        } catch {
                            // 忽略 JSON 解析失败
                        }
                        currentEventType = '';
                    }
                }
            }
        } catch (err: any) {
            yield { text: `Bridge SSE 连接失败: ${err?.message || String(err)}`, status: 'error' };
        }
    }
}
