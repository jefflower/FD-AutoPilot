import { tauriInvoke, detectSkills as bridgeDetectSkills, detectModels as bridgeDetectModels } from '../../../tauri/bridge';
import type { SkillInfo } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseAgentConfig } from '../schemaUtils';

/** Antigravity Tools 执行器内置默认值 */
const DEFAULTS = {
    invokeCommand: 'execute_antigravity_cmd',
    model: 'gemini-2.5-flash',
};

/**
 * Antigravity Tools 执行器
 *
 * 通过 Tauri invoke / HTTP Bridge 调用本地 Antigravity Tools 代理。
 * Antigravity Tools 是一个桌面 AI 代理，将 Google Antigravity IDE 的 OAuth 会话
 * 转换为 OpenAI 兼容的 API 端点（localhost:8045）。
 * 提示词由服务端统一构造（resolvedPrompt），客户端透传给 bridge 端点执行。
 */
export class AntigravityToolsExecutor implements AgentExecutor {
    readonly providerType = 'ANTIGRAVITY_TOOLS' as const;
    readonly supportedCapability = 'antigravity-tools';

    isAvailable(): boolean {
        return true;
    }

    async getAvailableModels(): Promise<string[]> {
        const result = await bridgeDetectModels('antigravity-tools');
        return result.models;
    }

    async detectSkills(): Promise<SkillInfo[]> {
        const result = await bridgeDetectSkills('antigravity-tools');
        return result.skills;
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        // 三级合并：DEFAULTS < definition.agentConfig < input.params（服务端 mergedConfig）
        const agentConfig = parseAgentConfig(definition.agentConfig);
        const mergedParams = input.params || {};
        const config: Record<string, any> = { ...DEFAULTS, ...agentConfig, ...mergedParams };
        const startTime = Date.now();

        try {
            const invokeCommand = config.invokeCommand;

            // 服务端已解析的最终提示词
            const prompt = config.resolvedPrompt;
            if (!prompt) {
                throw new Error(`Agent "${definition.code}" 缺少 resolvedPrompt，请检查服务端是否正确下发`);
            }

            // model 选择（单模型，不像 CLI 支持多模型 fallback）
            const model = config.model || DEFAULTS.model;

            console.log(`[AntigravityToolsExecutor] ${invokeCommand}: agentCode=${definition.code}, prompt length=${prompt.length}, model=${model}`);

            const params: Record<string, any> = {
                prompt,
                model,
                agentCode: definition.code,
            };
            if (config.systemPrompt) {
                params.systemPrompt = config.systemPrompt;
            }
            if (config.temperature != null) {
                params.temperature = config.temperature;
            }

            const result = await tauriInvoke<string>(invokeCommand, params);

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
