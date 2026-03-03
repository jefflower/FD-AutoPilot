import type { AgentDefinition, AgentProviderType, AgentExecuteInput, AgentExecuteResult, AgentStreamChunk } from '../../types/server';

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
    execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult>;
    executeStream?(definition: AgentDefinition, input: AgentExecuteInput): AsyncGenerator<AgentStreamChunk>;
}
