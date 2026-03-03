import { tauriInvoke } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult } from '../../types/server';
import { parseAgentConfig, resolveTemplate } from '../schemaUtils';
import { formatTicketContent } from '../helpers/translationHelpers';

/**
 * CLAUDE_CLI 执行器
 *
 * 通过 Tauri invoke 调用本地 Claude CLI 工具。
 * 支持 Tauri 桌面环境（IPC）和 Web 浏览器环境（HTTP bridge）。
 *
 * 执行路径：
 * - 从 AgentDefinition.systemPrompt 读取 prompt 模板
 * - 用 input.data 中的变量展开模板
 * - 调用 execute_claude_cmd（-p prompt --output-format text）
 * - 返回 Claude CLI 的 stdout 输出
 */
export class ClaudeCliExecutor implements AgentExecutor {
    readonly providerType = 'CLAUDE_CLI' as const;
    readonly supportedCapability = 'claude-cli';

    isAvailable(): boolean {
        // Tauri 环境直接可用；Web 环境通过 HTTP bridge 也可用
        return true;
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        const config = parseAgentConfig(definition.agentConfig);
        const startTime = Date.now();

        try {
            const invokeCommand = config.invokeCommand || 'execute_claude_cmd';

            // 构建模板变量
            const templateVars: Record<string, string> = {};

            // 从 input.data 中读取可能的模板变量
            if (input.data?.ticket) {
                const ticket = input.data.ticket;
                templateVars.TICKET_CONTENT = formatTicketContent(ticket);
                templateVars.TICKET_SUBJECT = ticket.subject || '';
                templateVars.TICKET_ID = String(ticket.id || '');
            }
            if (input.data?.conversationHistory) {
                templateVars.CONVERSATION_HISTORY = input.data.conversationHistory;
            }
            if (input.data?.userMessage) {
                templateVars.USER_MESSAGE = input.data.userMessage;
            }
            if (input.data?.workspaceDocs) {
                templateVars.WORKSPACE_DOCS = input.data.workspaceDocs;
            }
            if (input.data?.currentWorkflowJson) {
                templateVars.CURRENT_WORKFLOW_JSON = input.data.currentWorkflowJson;
            }
            if (input.data?.prompt) {
                templateVars.PROMPT = input.data.prompt;
            }
            if (input.data?.query) {
                templateVars.QUERY = input.data.query;
            }
            if (input.data?.targetLang) {
                templateVars.TARGET_LANG = input.data.targetLang;
            }
            if (input.data?.lastAuditRemark) {
                templateVars.LAST_AUDIT_REMARK = input.data.lastAuditRemark;
            }

            // prompt 来源优先级：
            // 1. input.data.prompt — SyncBridge 任务已包含完全展开的 prompt
            // 2. definition.systemPrompt — 模板展开
            // 3. input.data.query — 直接查询
            let prompt: string;
            if (input.data?.prompt) {
                // SyncBridge 场景：后端 AgentChatService 已展开模板，直接使用
                prompt = input.data.prompt;
            } else if (definition.systemPrompt) {
                prompt = resolveTemplate(definition.systemPrompt, templateVars);
            } else if (input.data?.query) {
                prompt = input.data.query;
            } else {
                return {
                    success: false,
                    output: null,
                    durationMs: 0,
                    error: 'Claude CLI Agent 缺少 systemPrompt 或 prompt 参数',
                };
            }

            console.log(`[ClaudeCliExecutor] ${invokeCommand}: prompt length=${prompt.length}`);

            // 构建元数据（用于 bridge 执行日志）
            const metadata: Record<string, any> = {};
            if (input.data?.ticket) {
                metadata.ticketId = input.data.ticket.id;
                metadata.subject = input.data.ticket.subject;
                metadata.refType = 'ticket';
                metadata.refId = String(input.data.ticket.id || '');
            }
            metadata.agentName = definition.name;

            const result = await tauriInvoke<string>(invokeCommand, {
                prompt,
                agentCode: definition.code,
                metadata,
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
