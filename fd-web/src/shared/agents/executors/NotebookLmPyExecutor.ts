import { tauriInvoke } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseAgentConfig, resolveTemplate } from '../schemaUtils';
import { formatTicketContent } from '../helpers/translationHelpers';

/**
 * NOTEBOOKLM_PY 执行器
 *
 * 通过 Tauri invoke 调用本地 notebooklm-py Python 库查询 NotebookLM 知识库。
 * 区别于 NotebookLmExecutor（Shadow Window 浏览器自动化），此执行器使用 Python CLI 方式，
 * 更稳定、无需浏览器窗口。
 *
 * 执行器自行读取 AgentDefinition 的 systemPrompt 和 agentConfig.notebookId，
 * 外部只需传入标准化工单数据 { ticket: { id, subject, content }, lastAuditRemark? }。
 * systemPrompt 中的 ${TICKET_CONTENT} 会被模板展开为工单 JSON。
 */
export class NotebookLmPyExecutor implements AgentExecutor {
    readonly providerType = 'NOTEBOOKLM_PY' as const;

    isAvailable(): boolean {
        return true;
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        const config = parseAgentConfig(definition.agentConfig);
        const startTime = Date.now();

        try {
            const invokeCommand = config.invokeCommand || 'execute_notebooklm_py_cmd';

            // notebookId 从 AgentDefinition.agentConfig 读取，外部不需要传入
            const notebookId = config.notebookId || '';

            // 构建 query：从 definition.systemPrompt 模板展开
            // 标准化路径：外部传入 { ticket: { id, subject, content }, lastAuditRemark? }
            const ticket = input.data?.ticket;
            let query: string;

            if (ticket && definition.systemPrompt) {
                // 标准化路径：使用 Agent 配置的 systemPrompt + 模板展开
                const ticketContent = formatTicketContent(ticket);
                const templateVars: Record<string, string> = {
                    TICKET_CONTENT: ticketContent,
                    LAST_AUDIT_REMARK: input.data?.lastAuditRemark || '',
                    TICKET_SUBJECT: ticket.subject || '',
                    TICKET_ID: String(ticket.id || ''),
                };
                query = resolveTemplate(definition.systemPrompt, templateVars);
            } else if (input.data?.query || input.data?.prompt) {
                // 兼容路径：直接使用传入的 query（兜底）
                query = input.data.query || input.data.prompt;
            } else {
                return {
                    success: false,
                    output: null,
                    durationMs: 0,
                    error: 'NotebookLM-py Agent 缺少工单数据或 query 参数',
                };
            }

            console.log(`[NotebookLmPyExecutor] ${invokeCommand}: query length=${query.length}, notebookId=${notebookId ? notebookId.substring(0, 8) + '...' : '(default)'}`);

            const result = await tauriInvoke<string>(invokeCommand, {
                query,
                notebookId,
                agentCode: definition.code,
            });

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
