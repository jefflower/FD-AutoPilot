import { isTauriEnv } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult, AgentStreamChunk } from '../../types/server';

/**
 * SHADOW_WINDOW 执行器
 *
 * 通过 Tauri Shadow Window 与在线工具交互（如 NotebookLM、17track）。
 * 仅在 Tauri 桌面环境下可用。支持流式输出（executeStream）。
 *
 * 具体的 Shadow Window 交互逻辑由业务层通过 input.params.shadowHandler 传入。
 */
export class ShadowExecutor implements AgentExecutor {
    readonly providerType = 'SHADOW_WINDOW' as const;

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
            }

            return {
                success: true,
                output: fullText,
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
}
