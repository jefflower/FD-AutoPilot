import { useState, useCallback } from 'react';
import { AgentRegistry } from './AgentRegistry';
import type { AgentExecuteInput, AgentExecuteResult, AgentStreamChunk, AgentExecutionReport } from '../types/server';

/** 将值安全转为字符串（不截断，完整保留便于调试） */
function safeStr(str: string | undefined): string | undefined {
    return str || undefined;
}

async function reportExecution(report: AgentExecutionReport): Promise<void> {
    try {
        const { agentApi } = await import('../services/serverApi');
        await agentApi.reportExecution(report);
    } catch (err) {
        console.warn('[useAgent] Failed to report execution:', err);
    }
}

/**
 * useAgent Hook — 统一的 Agent 同步执行入口
 */
export function useAgent(agentCode: string) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<any>(null);

    const execute = useCallback(async (input: AgentExecuteInput): Promise<AgentExecuteResult> => {
        const startTime = Date.now();
        setLoading(true);
        setError(null);
        setResult(null);

        const registry = AgentRegistry.getInstance();
        const resolved = registry.resolve(agentCode);

        if (!resolved) {
            const errMsg = `Agent "${agentCode}" 未找到或不可用`;
            setError(errMsg);
            setLoading(false);
            throw new Error(errMsg);
        }

        const { definition, executor } = resolved;

        try {
            const execResult = await executor.execute(definition, input);
            setResult(execResult.output);

            if (!execResult.success) {
                setError(execResult.error || 'Agent 执行失败');
            }

            reportExecution({
                agentCode,
                status: execResult.success ? 'SUCCESS' : 'FAILED',
                durationMs: Date.now() - startTime,
                tokenCount: execResult.tokenCount,
                referenceType: input.referenceType,
                referenceId: input.referenceId,
                executedOn: 'client',
                inputSnapshot: safeStr(JSON.stringify(input.data)),
                outputSnapshot: safeStr(typeof execResult.output === 'string' ? execResult.output : JSON.stringify(execResult.output)),
                errorMessage: execResult.error,
            });

            return execResult;
        } catch (err: any) {
            const errMsg = err?.message || String(err);
            setError(errMsg);

            reportExecution({
                agentCode,
                status: 'FAILED',
                durationMs: Date.now() - startTime,
                referenceType: input.referenceType,
                referenceId: input.referenceId,
                executedOn: 'client',
                inputSnapshot: safeStr(JSON.stringify(input.data)),
                errorMessage: errMsg,
            });

            throw err;
        } finally {
            setLoading(false);
        }
    }, [agentCode]);

    return { execute, loading, error, result };
}

/**
 * useAgentStream Hook — 流式 Agent 执行（用于 Shadow Window 等场景）
 */
export function useAgentStream(agentCode: string) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [streamText, setStreamText] = useState('');

    const executeStream = useCallback(async function* (input: AgentExecuteInput): AsyncGenerator<AgentStreamChunk> {
        const startTime = Date.now();
        setLoading(true);
        setError(null);
        setStreamText('');

        const registry = AgentRegistry.getInstance();
        const resolved = registry.resolve(agentCode);

        if (!resolved) {
            const errMsg = `Agent "${agentCode}" 未找到或不可用`;
            setError(errMsg);
            setLoading(false);
            yield { text: errMsg, status: 'error' };
            return;
        }

        const { definition, executor } = resolved;

        if (!executor.executeStream) {
            const errMsg = `Agent "${agentCode}" 不支持流式执行`;
            setError(errMsg);
            setLoading(false);
            yield { text: errMsg, status: 'error' };
            return;
        }

        let lastText = '';
        let success = true;
        let errorMsg: string | undefined;

        try {
            for await (const chunk of executor.executeStream(definition, input)) {
                lastText = chunk.text;
                setStreamText(chunk.text);

                if (chunk.status === 'error') {
                    success = false;
                    errorMsg = chunk.text;
                    setError(chunk.text);
                }

                yield chunk;
            }
        } catch (err: any) {
            success = false;
            errorMsg = err?.message || String(err);
            setError(errorMsg ?? null);
            yield { text: errorMsg ?? '', status: 'error' };
        } finally {
            setLoading(false);

            reportExecution({
                agentCode,
                status: success ? 'SUCCESS' : 'FAILED',
                durationMs: Date.now() - startTime,
                referenceType: input.referenceType,
                referenceId: input.referenceId,
                executedOn: 'client',
                inputSnapshot: safeStr(JSON.stringify(input.data)),
                outputSnapshot: safeStr(lastText),
                errorMessage: errorMsg,
            });
        }
    }, [agentCode]);

    return { executeStream, loading, error, streamText };
}
