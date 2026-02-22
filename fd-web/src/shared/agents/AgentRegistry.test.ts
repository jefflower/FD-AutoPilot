import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from './AgentRegistry';
import type { AgentExecutor } from './executors/types';
import type { AgentDefinition, AgentBindings } from '../types/server';

// ============ Mock agentApi ============
vi.mock('../services/serverApi', () => ({
    agentApi: {
        getDefinitions: vi.fn(),
        getBindings: vi.fn(),
        reportExecution: vi.fn(),
    },
}));

// 动态获取 mock 引用
const getAgentApiMock = async () => {
    const mod = await import('../services/serverApi');
    return mod.agentApi as {
        getDefinitions: ReturnType<typeof vi.fn>;
        getBindings: ReturnType<typeof vi.fn>;
        reportExecution: ReturnType<typeof vi.fn>;
    };
};

// ============ 测试数据工厂 ============
function makeDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
    return {
        id: 1,
        code: 'test-agent',
        name: 'Test Agent',
        description: 'A test agent',
        providerType: 'LOCAL_CLI',
        executionEnv: 'CLIENT_ONLY',
        capability: 'translate',
        providerConfig: {},
        enabled: true,
        sortOrder: 0,
        builtIn: false,
        ...overrides,
    };
}

function makeExecutor(providerType: AgentDefinition['providerType'] = 'LOCAL_CLI', available = true): AgentExecutor {
    return {
        providerType,
        isAvailable: vi.fn(() => available),
        execute: vi.fn().mockResolvedValue({ success: true, output: 'result', durationMs: 100 }),
    };
}

// ============ 单例重置辅助 ============
/**
 * AgentRegistry 是单例，通过直接修改私有静态字段重置，确保每个测试用例隔离。
 */
function resetRegistry(): void {
    // 强制清除单例实例
    (AgentRegistry as any).instance = undefined;
}

// ============ 测试套件 ============
describe('AgentRegistry', () => {
    beforeEach(() => {
        resetRegistry();
        vi.clearAllMocks();
    });

    afterEach(() => {
        resetRegistry();
    });

    // ── 单例行为 ──────────────────────────────────────────────────────────────

    describe('getInstance()', () => {
        it('多次调用返回同一实例', () => {
            const a = AgentRegistry.getInstance();
            const b = AgentRegistry.getInstance();
            expect(a).toBe(b);
        });

        it('reset 后重新创建新实例', () => {
            const a = AgentRegistry.getInstance();
            resetRegistry();
            const b = AgentRegistry.getInstance();
            expect(a).not.toBe(b);
        });
    });

    // ── registerExecutor ──────────────────────────────────────────────────────

    describe('registerExecutor()', () => {
        it('注册后可通过 resolve 找到对应 executor', async () => {
            const registry = AgentRegistry.getInstance();
            const executor = makeExecutor('LOCAL_CLI');
            registry.registerExecutor(executor);

            const def = makeDefinition({ code: 'agent-a', providerType: 'LOCAL_CLI' });
            // 手动填充 definitions（通过 loadDefinitions mock）
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([def]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            const resolved = registry.resolve('agent-a');
            expect(resolved).not.toBeNull();
            expect(resolved!.executor).toBe(executor);
        });

        it('注册不同 providerType 的 executor 互不干扰', async () => {
            const registry = AgentRegistry.getInstance();
            const cliExecutor = makeExecutor('LOCAL_CLI');
            const httpExecutor = makeExecutor('HTTP_API');
            registry.registerExecutor(cliExecutor);
            registry.registerExecutor(httpExecutor);

            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([
                makeDefinition({ code: 'cli-agent', providerType: 'LOCAL_CLI' }),
                makeDefinition({ code: 'http-agent', providerType: 'HTTP_API' }),
            ]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            expect(registry.resolve('cli-agent')!.executor).toBe(cliExecutor);
            expect(registry.resolve('http-agent')!.executor).toBe(httpExecutor);
        });

        it('后注册的同类型 executor 覆盖先注册的', async () => {
            const registry = AgentRegistry.getInstance();
            const first = makeExecutor('LOCAL_CLI');
            const second = makeExecutor('LOCAL_CLI');
            registry.registerExecutor(first);
            registry.registerExecutor(second);

            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([makeDefinition({ code: 'x', providerType: 'LOCAL_CLI' })]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            expect(registry.resolve('x')!.executor).toBe(second);
        });
    });

    // ── loadDefinitions ───────────────────────────────────────────────────────

    describe('loadDefinitions()', () => {
        it('成功加载定义和绑定', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            const defs = [
                makeDefinition({ code: 'a1', capability: 'translate' }),
                makeDefinition({ code: 'a2', capability: 'reply' }),
            ];
            const bindings: AgentBindings = { translate: 'a1' };
            apiMock.getDefinitions.mockResolvedValue(defs);
            apiMock.getBindings.mockResolvedValue(bindings);

            await registry.loadDefinitions();

            expect(registry.getAllDefinitions()).toHaveLength(2);
            expect(registry.getBindings()).toEqual(bindings);
        });

        it('providerConfig 是 JSON 字符串时自动解析为对象', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            const def = makeDefinition({ code: 'cfg-agent', providerConfig: '{"model":"gpt-4"}' as any });
            apiMock.getDefinitions.mockResolvedValue([def]);
            apiMock.getBindings.mockResolvedValue({});

            await registry.loadDefinitions();

            const loaded = registry.getDefinitionByCode('cfg-agent');
            expect(loaded!.providerConfig).toEqual({ model: 'gpt-4' });
        });

        it('providerConfig 是非法 JSON 时回退为空对象', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            const def = makeDefinition({ code: 'bad-cfg', providerConfig: '{invalid json}' as any });
            apiMock.getDefinitions.mockResolvedValue([def]);
            apiMock.getBindings.mockResolvedValue({});

            await registry.loadDefinitions();

            const loaded = registry.getDefinitionByCode('bad-cfg');
            expect(loaded!.providerConfig).toEqual({});
        });

        it('API 失败时不抛出异常，definitions 保持不变', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockRejectedValue(new Error('Network error'));

            await expect(registry.loadDefinitions()).resolves.toBeUndefined();
            expect(registry.getAllDefinitions()).toHaveLength(0);
        });

        it('重复 loadDefinitions 清除旧数据', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();

            apiMock.getDefinitions.mockResolvedValueOnce([makeDefinition({ code: 'first' })]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();
            expect(registry.getAllDefinitions()).toHaveLength(1);

            apiMock.getDefinitions.mockResolvedValueOnce([
                makeDefinition({ code: 'second-a' }),
                makeDefinition({ code: 'second-b' }),
            ]);
            await registry.loadDefinitions();
            expect(registry.getAllDefinitions()).toHaveLength(2);
            expect(registry.getDefinitionByCode('first')).toBeUndefined();
        });
    });

    // ── resolve ───────────────────────────────────────────────────────────────

    describe('resolve()', () => {
        it('找到定义和 executor 时返回 { definition, executor }', async () => {
            const registry = AgentRegistry.getInstance();
            const executor = makeExecutor('LOCAL_CLI');
            registry.registerExecutor(executor);

            const def = makeDefinition({ code: 'target', providerType: 'LOCAL_CLI' });
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([def]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            const result = registry.resolve('target');
            expect(result).not.toBeNull();
            expect(result!.definition.code).toBe('target');
            expect(result!.executor).toBe(executor);
        });

        it('定义不存在时返回 null', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            expect(registry.resolve('nonexistent')).toBeNull();
        });

        it('定义 enabled=false 时返回 null', async () => {
            const registry = AgentRegistry.getInstance();
            const executor = makeExecutor('LOCAL_CLI');
            registry.registerExecutor(executor);

            const def = makeDefinition({ code: 'disabled', enabled: false });
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([def]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            expect(registry.resolve('disabled')).toBeNull();
        });

        it('对应 executor 未注册时返回 null', async () => {
            const registry = AgentRegistry.getInstance();
            // 不注册任何 executor

            const def = makeDefinition({ code: 'no-exec', providerType: 'HTTP_API' });
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([def]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            expect(registry.resolve('no-exec')).toBeNull();
        });

        it('executor.isAvailable() 返回 false 时返回 null', async () => {
            const registry = AgentRegistry.getInstance();
            const unavailableExecutor = makeExecutor('SHADOW_WINDOW', false);
            registry.registerExecutor(unavailableExecutor);

            const def = makeDefinition({ code: 'shadow-agent', providerType: 'SHADOW_WINDOW' });
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([def]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            expect(registry.resolve('shadow-agent')).toBeNull();
        });
    });

    // ── resolveByCapability ───────────────────────────────────────────────────

    describe('resolveByCapability()', () => {
        it('有绑定且 agent 可用时成功解析', async () => {
            const registry = AgentRegistry.getInstance();
            const executor = makeExecutor('LOCAL_CLI');
            registry.registerExecutor(executor);

            const def = makeDefinition({ code: 'translate-agent', capability: 'translate' });
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([def]);
            apiMock.getBindings.mockResolvedValue({ translate: 'translate-agent' });
            await registry.loadDefinitions();

            const result = registry.resolveByCapability('translate');
            expect(result).not.toBeNull();
            expect(result!.definition.code).toBe('translate-agent');
        });

        it('未配置绑定时返回 null', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([makeDefinition({ capability: 'reply' })]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            expect(registry.resolveByCapability('reply')).toBeNull();
        });

        it('绑定的 agent 不存在时返回 null', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([]);
            apiMock.getBindings.mockResolvedValue({ translate: 'ghost-agent' });
            await registry.loadDefinitions();

            expect(registry.resolveByCapability('translate')).toBeNull();
        });

        it('绑定的 agent 已禁用时返回 null', async () => {
            const registry = AgentRegistry.getInstance();
            const executor = makeExecutor('LOCAL_CLI');
            registry.registerExecutor(executor);

            const def = makeDefinition({ code: 'disabled-agent', enabled: false });
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([def]);
            apiMock.getBindings.mockResolvedValue({ translate: 'disabled-agent' });
            await registry.loadDefinitions();

            expect(registry.resolveByCapability('translate')).toBeNull();
        });

        it('不自动回退到同 capability 的其他 agent', async () => {
            const registry = AgentRegistry.getInstance();
            const executor = makeExecutor('LOCAL_CLI');
            registry.registerExecutor(executor);

            // 有 capability='translate' 的 agent 但没有绑定
            const def = makeDefinition({ code: 'fallback-agent', capability: 'translate' });
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([def]);
            apiMock.getBindings.mockResolvedValue({}); // 无绑定
            await registry.loadDefinitions();

            // 必须返回 null，不能自动回退
            expect(registry.resolveByCapability('translate')).toBeNull();
        });
    });

    // ── hasBinding ────────────────────────────────────────────────────────────

    describe('hasBinding()', () => {
        it('已配置绑定时返回 true', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([]);
            apiMock.getBindings.mockResolvedValue({ translate: 'some-agent' });
            await registry.loadDefinitions();

            expect(registry.hasBinding('translate')).toBe(true);
        });

        it('未配置绑定时返回 false', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            expect(registry.hasBinding('translate')).toBe(false);
        });
    });

    // ── findByCapability ──────────────────────────────────────────────────────

    describe('findByCapability()', () => {
        it('过滤出指定 capability 且已启用的定义', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([
                makeDefinition({ code: 'a1', capability: 'translate', enabled: true }),
                makeDefinition({ code: 'a2', capability: 'translate', enabled: false }),
                makeDefinition({ code: 'a3', capability: 'reply', enabled: true }),
            ]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            const results = registry.findByCapability('translate');
            expect(results).toHaveLength(1);
            expect(results[0].code).toBe('a1');
        });

        it('没有匹配时返回空数组', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([makeDefinition({ capability: 'reply' })]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            expect(registry.findByCapability('audit')).toHaveLength(0);
        });
    });

    // ── getAllDefinitions ─────────────────────────────────────────────────────

    describe('getAllDefinitions()', () => {
        it('返回所有已加载的定义（含禁用）', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([
                makeDefinition({ code: 'enabled-agent', enabled: true }),
                makeDefinition({ code: 'disabled-agent', enabled: false }),
            ]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            const all = registry.getAllDefinitions();
            expect(all).toHaveLength(2);
            expect(all.map(d => d.code)).toContain('disabled-agent');
        });

        it('未加载时返回空数组', () => {
            const registry = AgentRegistry.getInstance();
            expect(registry.getAllDefinitions()).toHaveLength(0);
        });
    });

    // ── getBindings ───────────────────────────────────────────────────────────

    describe('getBindings()', () => {
        it('返回绑定的浅拷贝', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            const bindings: AgentBindings = { translate: 'agent-a', reply: 'agent-b' };
            apiMock.getDefinitions.mockResolvedValue([]);
            apiMock.getBindings.mockResolvedValue(bindings);
            await registry.loadDefinitions();

            const copy1 = registry.getBindings();
            const copy2 = registry.getBindings();
            expect(copy1).toEqual(bindings);
            // 浅拷贝：两次调用返回不同对象
            expect(copy1).not.toBe(copy2);
        });

        it('修改返回的绑定不影响内部状态', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            apiMock.getDefinitions.mockResolvedValue([]);
            apiMock.getBindings.mockResolvedValue({ translate: 'agent-a' });
            await registry.loadDefinitions();

            const copy = registry.getBindings();
            copy['translate'] = 'tampered';

            // 内部状态未被修改
            expect(registry.getBindings()['translate']).toBe('agent-a');
        });
    });

    // ── getDefinitionByCode ───────────────────────────────────────────────────

    describe('getDefinitionByCode()', () => {
        it('存在时返回定义', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();
            const def = makeDefinition({ code: 'lookup-me' });
            apiMock.getDefinitions.mockResolvedValue([def]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();

            expect(registry.getDefinitionByCode('lookup-me')).toMatchObject({ code: 'lookup-me' });
        });

        it('不存在时返回 undefined', () => {
            const registry = AgentRegistry.getInstance();
            expect(registry.getDefinitionByCode('ghost')).toBeUndefined();
        });
    });

    // ── reload ────────────────────────────────────────────────────────────────

    describe('reload()', () => {
        it('刷新后反映最新数据', async () => {
            const registry = AgentRegistry.getInstance();
            const apiMock = await getAgentApiMock();

            apiMock.getDefinitions.mockResolvedValueOnce([makeDefinition({ code: 'v1' })]);
            apiMock.getBindings.mockResolvedValue({});
            await registry.loadDefinitions();
            expect(registry.getDefinitionByCode('v1')).toBeDefined();

            // 模拟后端数据更新
            apiMock.getDefinitions.mockResolvedValueOnce([
                makeDefinition({ code: 'v2-a' }),
                makeDefinition({ code: 'v2-b' }),
            ]);
            await registry.reload();

            expect(registry.getDefinitionByCode('v1')).toBeUndefined();
            expect(registry.getDefinitionByCode('v2-a')).toBeDefined();
            expect(registry.getAllDefinitions()).toHaveLength(2);
        });
    });
});
