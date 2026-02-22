import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';

type AgentFunction = (input: AgentExecuteInput, config: Record<string, any>) => Promise<any>;

const functionRegistry = new Map<string, AgentFunction>();

/** 注册一个本地函数，供 LOCAL_FUNCTION Agent 调用 */
export function registerAgentFunction(name: string, fn: AgentFunction): void {
    functionRegistry.set(name, fn);
}

/**
 * LOCAL_FUNCTION 执行器
 *
 * 执行预注册的本地 JS 函数。
 * 用于规则引擎、模板填充等无需外部 AI 的场景。
 */
export class FunctionExecutor implements AgentExecutor {
    readonly providerType = 'LOCAL_FUNCTION' as const;

    isAvailable(): boolean {
        return true;
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        const config = typeof definition.providerConfig === 'string'
            ? JSON.parse(definition.providerConfig) : definition.providerConfig;
        const functionName = config.functionName;

        if (!functionName) {
            return {
                success: false,
                output: null,
                durationMs: 0,
                error: 'LOCAL_FUNCTION Agent 缺少 functionName 配置',
            };
        }

        const fn = functionRegistry.get(functionName);
        if (!fn) {
            return {
                success: false,
                output: null,
                durationMs: 0,
                error: `函数 "${functionName}" 未注册`,
            };
        }

        const startTime = Date.now();
        try {
            const result = await fn(input, config);
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
