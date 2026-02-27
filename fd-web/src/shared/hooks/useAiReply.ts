import { useCallback } from 'react';
import { serverApi } from '../services/serverApi';
import { AgentRegistry } from '../agents/AgentRegistry';
import { extractReplyArray } from '../ai/parseUtils';
import type { StandardAgentInput } from '../types/server';

interface AiReplyOptions {
    onStatusChange?: (status: 'replying' | null) => void;
    onError?: (error: string) => void;
    onStreamChunk?: (text: string) => void;
    onParsed?: (replies: [string, string]) => void;
    onPromptReady?: (prompt: string) => void;
    autoSave?: boolean;
}

export function useAiReply() {
    const runReply = useCallback(async (ticket: any, options: AiReplyOptions = {}): Promise<boolean> => {
        const { onStatusChange, onError, onStreamChunk, onParsed, autoSave } = options;

        console.log(`[useAiReply] Starting reply generation for ticket #${ticket.id}, autoSave=${autoSave}`);
        onStatusChange?.('replying');

        try {
            const registry = AgentRegistry.getInstance();

            // 优先使用注入的 agentCode（面板指定 > 工作流指定 > capability 绑定）
            const injectedAgentCode = (ticket as any)._agentCode as string | undefined;
            let resolved = injectedAgentCode
                ? registry.resolve(injectedAgentCode)
                : registry.resolveByCapability('reply');

            // Fallback: 指定 agent 不可用时，按 capability 查找可用替代
            if (!resolved && injectedAgentCode) {
                console.warn(`[useAiReply] Agent "${injectedAgentCode}" 不可用，尝试 capability fallback`);
                resolved = registry.resolveByCapability('reply');
            }

            if (!resolved) {
                if (!registry.hasBinding('reply')) {
                    throw new Error('回复能力未配置 Agent，请在 Agent 管理 → 能力绑定页面为 "reply" 配置 Agent');
                }
                throw new Error('绑定的回复 Agent 在当前环境不可用，请检查 Agent 配置或更换可用的 Agent');
            }

            const { definition, executor } = resolved;

            let saveSuccess = false;
            let saveError: Error | null = null;
            let finalParsed: [string, string] | null = null;

            console.log(`[useAiReply] Using agent: ${definition.code} (${definition.name})`);

            // 标准化路径：构建 StandardAgentInput，Executor 自行构建 prompt
            // 优先使用工作流注入的 agentInput（来自 TaskInstance payload）
            const workflowInput = (ticket as any)._agentInput as StandardAgentInput | undefined;
            console.log(`[useAiReply] Standard path: agent=${definition.code}, fromWorkflow=${!!workflowInput}`);

            const standardInput: StandardAgentInput = workflowInput || {
                ticket: { id: ticket.id, subject: ticket.subject, content: ticket.content },
                lastAuditRemark: ticket.lastAuditRemark,
            };

            if (!executor.executeStream) {
                throw new Error(`Agent "${definition.code}" 不支持流式执行`);
            }

            for await (const chunk of executor.executeStream(definition, {
                data: standardInput,
                referenceType: 'ticket',
                referenceId: ticket.id,
            })) {
                if (chunk.status === 'error') {
                    throw new Error(chunk.text);
                }

                onStreamChunk?.(chunk.text);

                if (chunk.status === 'complete' && chunk.parsedOutput) {
                    // 标准路径：直接使用 Executor 返回的 parsedOutput
                    finalParsed = [chunk.parsedOutput.targetReply, chunk.parsedOutput.zhReply];
                    onParsed?.(finalParsed);
                    if (autoSave) {
                        try {
                            await serverApi.ticket.submitReply(ticket.id, {
                                zhReply: finalParsed[1],
                                targetReply: finalParsed[0]
                            });
                            saveSuccess = true;
                        } catch (err) {
                            console.error('Auto-save reply failed:', err);
                            saveError = err as Error;
                        }
                    }
                    break;
                }

                // Fallback: 如果 complete 但没有 parsedOutput，尝试自行解析
                if (chunk.status === 'complete') {
                    console.log(`[useAiReply] Complete chunk without parsedOutput, attempting manual parse. Text length: ${chunk.text?.length}`);
                    const parsed = extractReplyArray(chunk.text);
                    if (parsed) {
                        finalParsed = parsed;
                        onParsed?.(finalParsed);
                        if (autoSave) {
                            try {
                                await serverApi.ticket.submitReply(ticket.id, {
                                    zhReply: parsed[1], targetReply: parsed[0]
                                });
                                saveSuccess = true;
                            } catch (err) {
                                console.error('Auto-save reply failed:', err);
                                saveError = err as Error;
                            }
                        }
                        break;
                    } else {
                        console.warn(`[useAiReply] Manual parse also failed for complete chunk. First 500 chars:`, chunk.text?.substring(0, 500));
                    }
                }
            }

            // 流式结束后，如果 finalParsed 仍为 null，抛出明确错误（而非返回 false 导致无限循环）
            if (!finalParsed && !saveSuccess && !saveError) {
                throw new Error('回复结果解析失败：AI 返回的内容无法提取为 [targetReply, zhReply] 格式，请检查 Agent 配置和 NotebookLM 响应');
            }

            if (autoSave) {
                if (saveError) throw saveError;
                return saveSuccess;
            }

            return !!finalParsed;

        } catch (e) {
            console.error('[useAiReply] Error:', e);
            const errMsg = (e as Error).message || String(e);
            onError?.(errMsg);
            return false;
        } finally {
            onStatusChange?.(null);
        }
    }, []);

    return { runReply };
}
