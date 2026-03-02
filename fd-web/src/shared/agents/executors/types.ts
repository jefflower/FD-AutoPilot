import type { AgentDefinition, AgentProviderType, AgentExecuteInput, AgentExecuteResult, AgentStreamChunk } from '../../types/server';

/**
 * Agent 执行器接口
 *
 * 每种 ProviderType 对应一个执行器实现。
 */
export interface AgentExecutor {
    readonly providerType: AgentProviderType;
    isAvailable(): boolean;
    execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult>;
    executeStream?(definition: AgentDefinition, input: AgentExecuteInput): AsyncGenerator<AgentStreamChunk>;
}
