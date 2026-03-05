import type { AgentDefinition, AgentProviderType, AgentExecuteInput, AgentExecuteResult, AgentStreamChunk } from '../../types/server';
import type { SkillInfo } from '../../../tauri/bridge';

/**
 * Agent 执行器接口
 *
 * 每种 ProviderType 对应一个执行器实现。
 */
export interface AgentExecutor {
    readonly providerType: AgentProviderType;
    /** 该 executor 对应的 capability code，用于 capability 级路由 */
    readonly supportedCapability?: string;
    isAvailable(): boolean;
    /** 该能力支持的模型列表（不支持模型选择的返回空数组） */
    getAvailableModels(): Promise<string[]>;
    /** 探测该能力的 AI Skill 列表（不支持的返回空数组） */
    detectSkills(): Promise<SkillInfo[]>;
    execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult>;
    executeStream?(definition: AgentDefinition, input: AgentExecuteInput): AsyncGenerator<AgentStreamChunk>;
}
