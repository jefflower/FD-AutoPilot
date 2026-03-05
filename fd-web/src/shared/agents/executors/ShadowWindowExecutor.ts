import type { SkillInfo } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';

/**
 * Shadow Window 执行器（占位）
 *
 * 通过 Tauri Shadow Window 驱动浏览器自动化执行 AI 任务。
 * 当前为占位实现，后续将完善 Shadow Window 生命周期管理和 RPA 能力。
 *
 * 设计目标：
 * - 完全业务无关，与 GeminiCliExecutor 等保持一致的通用模板变量模式
 * - 通过 agentConfig 配置目标 URL、交互脚本等参数
 * - 支持 SSE 流式输出
 */
export class ShadowWindowExecutor implements AgentExecutor {
    readonly providerType = 'SHADOW_WINDOW' as const;
    readonly supportedCapability = 'shadow-window';

    isAvailable(): boolean {
        return true;
    }

    async getAvailableModels(): Promise<string[]> {
        return []; // Shadow Window 不需要模型选择
    }

    async detectSkills(): Promise<SkillInfo[]> {
        return []; // Shadow Window 不支持 skill 探测
    }

    async execute(_definition: AgentDefinition, _input: AgentExecuteInput): Promise<AgentExecuteResult> {
        return {
            success: false,
            output: null,
            durationMs: 0,
            error: 'Shadow Window Executor 尚未实现，请使用其他能力',
        };
    }
}
