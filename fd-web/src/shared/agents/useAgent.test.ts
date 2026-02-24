import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgent, useAgentStream } from './useAgent';
import { AgentRegistry } from './AgentRegistry';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../types/server';
import type { AgentExecutor } from './executors/types';

// ============ Mock agentApi ============
vi.mock('../services/serverApi', () => ({
    agentApi: {
        getDefinitions: vi.fn().mockResolvedValue([]),
        getBindings: vi.fn().mockResolvedValue({}),
        reportExecution: vi.fn().mockResolvedValue(undefined),
    },
}));

// ============ 工具函数 ============
function makeDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
    return {
        id: 1,
        code: 'mock-agent',
        name: 'Mock Agent',
        description: '',
        providerType: 'GEMINI_CLI',
        executionEnv: 'CLIENT_ONLY',
        capability: 'translate',
        providerConfig: {},
        enabled: true,
        sortOrder: 0,
        builtIn: false,
        ...overrides,
    };
}

function makeExecutor(
    providerType: AgentDefinition['providerType'] = 'GEMINI_CLI',
    available = true,
    execResult?: Partial<AgentExecuteResult>,
): AgentExecutor {
    return {
        providerType,
        isAvailable: vi.fn(() => available),
        execute: vi.fn().mockResolvedValue({
            success: true,
            output: 'translated text',
            durationMs: 50,
            tokenCount: 10,
            ...execResult,
        }),
    };
}

function resetRegistry(): void {
    (AgentRegistry as any).instance = undefined;
}

/**
 * 向 Registry 注入预置的 definition 和 executor，无需调用 loadDefinitions。
 * 直接操作私有 Map 绕过 API 调用，隔离 useAgent 逻辑与网络层。
 */
function seedRegistry(def: AgentDefinition, executor: AgentExecutor): AgentRegistry {
    const registry = AgentRegistry.getInstance();
    registry.registerExecutor(executor);
    (registry as any).definitions.set(def.code, def);
    return registry;
}

// ============ useAgent 测试 ============
describe('useAgent', () => {
    beforeEach(() => {
        resetRegistry();
        vi.clearAllMocks();
    });

    afterEach(() => {
        resetRegistry();
    });

    it('初始状态：loading=false, error=null, result=null', () => {
        const { result } = renderHook(() => useAgent('mock-agent'));
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.result).toBeNull();
    });

    it('execute 成功后 result 更新，loading 回到 false', async () => {
        const def = makeDefinition({ code: 'ok-agent' });
        const executor = makeExecutor('GEMINI_CLI', true, { output: 'hello world' });
        seedRegistry(def, executor);

        const { result } = renderHook(() => useAgent('ok-agent'));
        const input: AgentExecuteInput = { data: { text: 'hello' } };

        let execResult!: AgentExecuteResult;
        await act(async () => {
            execResult = await result.current.execute(input);
        });

        expect(execResult.success).toBe(true);
        expect(execResult.output).toBe('hello world');
        expect(result.current.result).toBe('hello world');
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('execute 执行期间 loading 为 true', async () => {
        const def = makeDefinition({ code: 'slow-agent' });
        let resolveFn!: (v: AgentExecuteResult) => void;
        const slowExecutor: AgentExecutor = {
            providerType: 'GEMINI_CLI',
            isAvailable: vi.fn(() => true),
            execute: vi.fn(() => new Promise<AgentExecuteResult>(r => { resolveFn = r; })),
        };
        seedRegistry(def, slowExecutor);

        const { result } = renderHook(() => useAgent('slow-agent'));
        const input: AgentExecuteInput = { data: {} };

        let executePromise!: Promise<AgentExecuteResult>;
        act(() => {
            executePromise = result.current.execute(input);
        });

        // 异步执行期间 loading 应为 true
        expect(result.current.loading).toBe(true);

        // 结束执行
        await act(async () => {
            resolveFn({ success: true, output: 'done', durationMs: 1 });
            await executePromise;
        });

        expect(result.current.loading).toBe(false);
    });

    it('agent 不存在时抛出异常并设置 error', async () => {
        // 不注册任何 agent
        const { result } = renderHook(() => useAgent('ghost-agent'));
        const input: AgentExecuteInput = { data: {} };

        await act(async () => {
            await expect(result.current.execute(input)).rejects.toThrow('Agent "ghost-agent" 未找到或不可用');
        });

        expect(result.current.error).toContain('ghost-agent');
        expect(result.current.loading).toBe(false);
    });

    it('executor.execute 抛出异常时 error 被设置，loading 回到 false', async () => {
        const def = makeDefinition({ code: 'err-agent' });
        const failExecutor: AgentExecutor = {
            providerType: 'GEMINI_CLI',
            isAvailable: vi.fn(() => true),
            execute: vi.fn().mockRejectedValue(new Error('CLI crashed')),
        };
        seedRegistry(def, failExecutor);

        const { result } = renderHook(() => useAgent('err-agent'));

        await act(async () => {
            await expect(result.current.execute({ data: {} })).rejects.toThrow('CLI crashed');
        });

        expect(result.current.error).toBe('CLI crashed');
        expect(result.current.loading).toBe(false);
    });

    it('executor 返回 success=false 时设置 error', async () => {
        const def = makeDefinition({ code: 'fail-result-agent' });
        const executor = makeExecutor('GEMINI_CLI', true, {
            success: false,
            output: null,
            error: 'Translation failed',
        });
        seedRegistry(def, executor);

        const { result } = renderHook(() => useAgent('fail-result-agent'));

        await act(async () => {
            await result.current.execute({ data: {} });
        });

        expect(result.current.error).toBe('Translation failed');
    });

    it('execute 成功后调用 agentApi.reportExecution', async () => {
        const def = makeDefinition({ code: 'report-agent' });
        const executor = makeExecutor('GEMINI_CLI', true, { success: true, output: 'ok' });
        seedRegistry(def, executor);

        const { agentApi } = await import('../services/serverApi');
        const reportMock = agentApi.reportExecution as ReturnType<typeof vi.fn>;

        const { result } = renderHook(() => useAgent('report-agent'));
        await act(async () => {
            await result.current.execute({ data: { text: 'input' }, referenceType: 'ticket', referenceId: 42 });
        });

        // reportExecution 是异步触发（fire-and-forget），等待微任务
        await vi.waitFor(() => {
            expect(reportMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    agentCode: 'report-agent',
                    status: 'SUCCESS',
                    executedOn: 'client',
                    referenceType: 'ticket',
                    referenceId: 42,
                }),
            );
        });
    });

    it('execute 失败时也调用 agentApi.reportExecution（status=FAILED）', async () => {
        const def = makeDefinition({ code: 'fail-report-agent' });
        const failExecutor: AgentExecutor = {
            providerType: 'GEMINI_CLI',
            isAvailable: vi.fn(() => true),
            execute: vi.fn().mockRejectedValue(new Error('boom')),
        };
        seedRegistry(def, failExecutor);

        const { agentApi } = await import('../services/serverApi');
        const reportMock = agentApi.reportExecution as ReturnType<typeof vi.fn>;

        const { result } = renderHook(() => useAgent('fail-report-agent'));
        await act(async () => {
            await expect(result.current.execute({ data: {} })).rejects.toThrow('boom');
        });

        await vi.waitFor(() => {
            expect(reportMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    agentCode: 'fail-report-agent',
                    status: 'FAILED',
                    errorMessage: 'boom',
                }),
            );
        });
    });

    it('多次 execute 互不干扰（每次重置 error 和 result）', async () => {
        const def = makeDefinition({ code: 'multi-agent' });
        const executor: AgentExecutor = {
            providerType: 'GEMINI_CLI',
            isAvailable: vi.fn(() => true),
            execute: vi.fn()
                .mockResolvedValueOnce({ success: false, output: null, durationMs: 1, error: 'first error' })
                .mockResolvedValueOnce({ success: true, output: 'second ok', durationMs: 1 }),
        };
        seedRegistry(def, executor);

        const { result } = renderHook(() => useAgent('multi-agent'));

        await act(async () => { await result.current.execute({ data: {} }); });
        expect(result.current.error).toBe('first error');

        await act(async () => { await result.current.execute({ data: {} }); });
        expect(result.current.error).toBeNull();
        expect(result.current.result).toBe('second ok');
    });
});

// ============ useAgentStream 测试 ============
describe('useAgentStream', () => {
    beforeEach(() => {
        resetRegistry();
        vi.clearAllMocks();
    });

    afterEach(() => {
        resetRegistry();
    });

    it('初始状态：loading=false, error=null, streamText=""', () => {
        const { result } = renderHook(() => useAgentStream('stream-agent'));
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.streamText).toBe('');
    });

    it('agent 不存在时 yield error chunk 并结束', async () => {
        const { result } = renderHook(() => useAgentStream('ghost-stream'));
        const chunks: any[] = [];

        await act(async () => {
            for await (const chunk of result.current.executeStream({ data: {} })) {
                chunks.push(chunk);
            }
        });

        expect(chunks).toHaveLength(1);
        expect(chunks[0].status).toBe('error');
        expect(chunks[0].text).toContain('ghost-stream');
        expect(result.current.loading).toBe(false);
    });

    it('executor 不支持 executeStream 时 yield error chunk', async () => {
        const def = makeDefinition({ code: 'no-stream-agent' });
        // makeExecutor 不含 executeStream 方法
        const executor = makeExecutor('GEMINI_CLI');
        seedRegistry(def, executor);

        const { result } = renderHook(() => useAgentStream('no-stream-agent'));
        const chunks: any[] = [];

        await act(async () => {
            for await (const chunk of result.current.executeStream({ data: {} })) {
                chunks.push(chunk);
            }
        });

        expect(chunks).toHaveLength(1);
        expect(chunks[0].status).toBe('error');
        expect(chunks[0].text).toContain('流式执行');
    });

    it('正常流式执行：中继所有 chunk 并更新 streamText', async () => {
        const def = makeDefinition({ code: 'stream-ok-agent' });
        const streamChunks = [
            { text: 'hello ', status: 'streaming' as const },
            { text: 'hello world', status: 'streaming' as const },
            { text: 'hello world!', status: 'complete' as const },
        ];

        async function* mockStream() {
            for (const c of streamChunks) yield c;
        }

        const streamExecutor: AgentExecutor = {
            providerType: 'GEMINI_CLI',
            isAvailable: vi.fn(() => true),
            execute: vi.fn(),
            executeStream: vi.fn(() => mockStream()),
        };
        seedRegistry(def, streamExecutor);

        const { result } = renderHook(() => useAgentStream('stream-ok-agent'));
        const received: any[] = [];

        await act(async () => {
            for await (const chunk of result.current.executeStream({ data: {} })) {
                received.push({ ...chunk });
            }
        });

        expect(received).toHaveLength(3);
        expect(received[2].status).toBe('complete');
        expect(result.current.streamText).toBe('hello world!');
        expect(result.current.loading).toBe(false);
    });

    it('流式执行遇到 error chunk 时设置 error 状态', async () => {
        const def = makeDefinition({ code: 'stream-err-agent' });

        async function* errorStream() {
            yield { text: 'partial result', status: 'streaming' as const };
            yield { text: 'stream error occurred', status: 'error' as const };
        }

        const streamExecutor: AgentExecutor = {
            providerType: 'GEMINI_CLI',
            isAvailable: vi.fn(() => true),
            execute: vi.fn(),
            executeStream: vi.fn(() => errorStream()),
        };
        seedRegistry(def, streamExecutor);

        const { result } = renderHook(() => useAgentStream('stream-err-agent'));

        await act(async () => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _chunk of result.current.executeStream({ data: {} })) { /* consume */ }
        });

        expect(result.current.error).toBe('stream error occurred');
    });
});
