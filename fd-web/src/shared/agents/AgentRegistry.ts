import type { AgentDefinition, AgentBindings } from '../types/server';
import type { AgentExecutor } from './executors/types';

/**
 * Agent 注册中心（单例）
 *
 * 职责：
 * 1. 从后端加载 Agent 定义和能力绑定
 * 2. 管理 Executor 实例
 * 3. 根据 agentCode 或 capability 解析到 { definition, executor }
 */
export class AgentRegistry {
    private static instance: AgentRegistry;

    private definitions = new Map<string, AgentDefinition>();
    private executors = new Map<string, AgentExecutor>();
    private bindings: AgentBindings = {};

    private constructor() {}

    static getInstance(): AgentRegistry {
        if (!AgentRegistry.instance) {
            AgentRegistry.instance = new AgentRegistry();
        }
        return AgentRegistry.instance;
    }

    async loadDefinitions(): Promise<void> {
        try {
            const { agentApi } = await import('../services/serverApi');

            const [defs, bindings] = await Promise.all([
                agentApi.getDefinitions(),
                agentApi.getBindings(),
            ]);

            this.definitions.clear();
            for (const def of defs) {
                if (typeof def.providerConfig === 'string') {
                    try {
                        def.providerConfig = JSON.parse(def.providerConfig as string);
                    } catch {
                        def.providerConfig = {};
                    }
                }
                this.definitions.set(def.code, def);
            }

            this.bindings = bindings || {};
            console.log(`[AgentRegistry] Loaded ${this.definitions.size} definitions, ${Object.keys(this.bindings).length} bindings`);
        } catch (err) {
            console.warn('[AgentRegistry] Failed to load definitions:', err);
        }
    }

    registerExecutor(executor: AgentExecutor): void {
        this.executors.set(executor.providerType, executor);
    }

    resolve(code: string): { definition: AgentDefinition; executor: AgentExecutor } | null {
        const definition = this.definitions.get(code);
        if (!definition || !definition.enabled) return null;

        const executor = this.executors.get(definition.providerType);
        if (!executor || !executor.isAvailable()) return null;

        return { definition, executor };
    }

    /**
     * 按 capability 解析（仅使用绑定配置）
     *
     * 必须在 Agent 管理 → 能力绑定页面配置 capability → agentCode 映射。
     * 未配置绑定时返回 null，不自动回退。
     */
    resolveByCapability(capability: string): { definition: AgentDefinition; executor: AgentExecutor } | null {
        const boundCode = this.bindings[capability];
        if (!boundCode) {
            console.warn(`[AgentRegistry] 能力 "${capability}" 未配置绑定，请在 Agent 管理 → 能力绑定页面配置`);
            return null;
        }

        const result = this.resolve(boundCode);
        if (!result) {
            const def = this.definitions.get(boundCode);
            if (!def) {
                console.warn(`[AgentRegistry] 能力 "${capability}" 绑定的 Agent "${boundCode}" 未找到或已禁用`);
            } else {
                const executor = this.executors.get(def.providerType);
                console.warn(`[AgentRegistry] 能力 "${capability}" 绑定的 Agent "${boundCode}" 不可用 (providerType=${def.providerType}, executorAvailable=${executor?.isAvailable() ?? false})`);
            }
        }
        return result;
    }

    /**
     * 检查某个能力是否已配置绑定
     */
    hasBinding(capability: string): boolean {
        return !!this.bindings[capability];
    }

    getDefinitionByCode(code: string): AgentDefinition | undefined {
        return this.definitions.get(code);
    }

    findByCapability(capability: string): AgentDefinition[] {
        return Array.from(this.definitions.values())
            .filter(d => d.capability === capability && d.enabled);
    }

    getAllDefinitions(): AgentDefinition[] {
        return Array.from(this.definitions.values());
    }

    getBindings(): AgentBindings {
        return { ...this.bindings };
    }

    async reload(): Promise<void> {
        await this.loadDefinitions();
    }
}
