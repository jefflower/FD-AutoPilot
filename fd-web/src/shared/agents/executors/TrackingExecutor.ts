import { isTauriEnv } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult, AgentStreamChunk } from '../../types/server';
import { parseProviderConfig } from '../schemaUtils';

/**
 * 物流查询执行器（17track Shadow Window）
 *
 * 通过 Tauri Shadow Window 查询物流信息。仅 Tauri 桌面模式可用。
 */
export class TrackingExecutor implements AgentExecutor {
    readonly providerType = 'TRACKING_SHADOW' as const;

    isAvailable(): boolean {
        return isTauriEnv();
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
        if (!isTauriEnv()) {
            yield { text: '物流查询 Agent 仅在 Tauri 桌面模式可用', status: 'error' };
            return;
        }

        const config = parseProviderConfig(definition.providerConfig);
        const { TrackingShadowService } = await import('../../../tauri/services/trackingShadow');
        const trackingNumbers: string[] = input.data.trackingNumbers || [];

        if (trackingNumbers.length === 0) {
            yield { text: '缺少物流单号', status: 'error' };
            return;
        }

        try {
            const maxNumbers = config.extractionConfig?.maxNumbers ?? 3;
            const service = new TrackingShadowService({
                targetUrl: config.targetUrl,
                selectors: config.selectors,
                extractionConfig: config.extractionConfig,
            });
            const results = await service.queryMultiple(trackingNumbers.slice(0, maxNumbers));
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
