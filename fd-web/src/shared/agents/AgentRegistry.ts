import type { AgentDefinition, AgentBindings, CapabilityDefinition } from '../types/server';
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
    private capabilities = new Map<string, CapabilityDefinition>();

    private constructor() {}

    static getInstance(): AgentRegistry {
        if (!AgentRegistry.instance) {
            AgentRegistry.instance = new AgentRegistry();
        }
        return AgentRegistry.instance;
    }

    async loadDefinitions(): Promise<void> {
        try {
            const { agentApi, capabilityApi } = await import('../services/serverApi');

            const [defs, bindings, caps] = await Promise.all([
                agentApi.getDefinitions(),
                agentApi.getBindings(),
                capabilityApi.getCapabilities().catch(() => [] as CapabilityDefinition[]),
            ]);

            this.definitions.clear();
            for (const def of defs) {
                if (typeof def.agentConfig === 'string') {
                    try {
                        def.agentConfig = JSON.parse(def.agentConfig as string);
                    } catch {
                        def.agentConfig = {};
                    }
                }
                this.definitions.set(def.code, def);
            }

            this.bindings = bindings || {};

            this.capabilities.clear();
            for (const cap of caps) {
                this.capabilities.set(cap.code, cap);
            }

            console.log(`[AgentRegistry] Loaded ${this.definitions.size} definitions, ${Object.keys(this.bindings).length} bindings, ${this.capabilities.size} capabilities`);
        } catch (err) {
            console.warn('[AgentRegistry] Failed to load definitions:', err);
        }
    }

    registerExecutor(executor: AgentExecutor): void {
        this.executors.set(executor.providerType, executor);
    }

    /** 旧 ProviderType -> 新 ProviderType 映射 */
    private mapLegacyProviderType(type: string): string | null {
        const LEGACY_MAP: Record<string, string> = {
            'LOCAL_CLI': 'GEMINI_CLI',
            'WEB_AUTOMATION': 'NOTEBOOKLM',
            'SHADOW_WINDOW': 'NOTEBOOKLM',
        };
        return LEGACY_MAP[type] || null;
    }

    /** 根据 providerType 查找 executor，兼容旧名称 */
    private findExecutor(providerType: string): AgentExecutor | undefined {
        let executor = this.executors.get(providerType);
        if (!executor) {
            const mapped = this.mapLegacyProviderType(providerType);
            if (mapped) executor = this.executors.get(mapped);
        }
        return executor;
    }

    isCapabilityEnabled(capabilityCode: string): boolean {
        const cap = this.capabilities.get(capabilityCode);
        return cap ? cap.enabled : true; // 未找到时默认 true（兼容旧数据）
    }

    getCapabilities(): CapabilityDefinition[] {
        return Array.from(this.capabilities.values());
    }

    resolve(code: string): { definition: AgentDefinition; executor: AgentExecutor } | null {
        const definition = this.definitions.get(code);
        if (!definition || !definition.enabled) return null;

        // Capability 检查：如果 Agent 依赖的 Capability 被禁用，则不可用
        if (definition.requiredCapability && !this.isCapabilityEnabled(definition.requiredCapability)) {
            return null;
        }

        // 推导 providerType: Agent 字段 > CapabilityDefinition.providerType
        let providerType = definition.providerType;
        if (!providerType && definition.requiredCapability) {
            const cap = this.capabilities.get(definition.requiredCapability);
            if (cap) providerType = cap.providerType;
        }

        const executor = providerType ? this.findExecutor(providerType) : undefined;
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
        // Capability 级别检查：如果 Capability 本身被禁用，直接返回 null
        if (!this.isCapabilityEnabled(capability)) {
            console.warn(`[AgentRegistry] 能力 "${capability}" 已被禁用`);
            return null;
        }

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
                // 推导 providerType: Agent 字段 > CapabilityDefinition.providerType
                let providerType = def.providerType;
                if (!providerType && def.requiredCapability) {
                    const cap = this.capabilities.get(def.requiredCapability);
                    if (cap) providerType = cap.providerType;
                }
                const executor = providerType ? this.findExecutor(providerType) : undefined;
                console.warn(`[AgentRegistry] 能力 "${capability}" 绑定的 Agent "${boundCode}" 不可用 (providerType=${def.providerType}, derivedProviderType=${providerType}, executorAvailable=${executor?.isAvailable() ?? false})`);
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
