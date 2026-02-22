import { isTauriEnv, tauriInvoke } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';

/**
 * LOCAL_CLI 执行器
 *
 * 通过 Tauri invoke 调用本地 CLI 工具（如 Gemini CLI）。
 * 仅在 Tauri 桌面环境下可用。
 */
export class CliExecutor implements AgentExecutor {
    readonly providerType = 'LOCAL_CLI' as const;

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

        const config = typeof definition.providerConfig === 'string'
            ? JSON.parse(definition.providerConfig) : definition.providerConfig;
        const startTime = Date.now();

        try {
            const invokeCommand = config.invokeCommand || config.cliCommand;
            if (!invokeCommand) {
                throw new Error('CLI Agent 缺少 invokeCommand 或 cliCommand 配置');
            }

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
}
