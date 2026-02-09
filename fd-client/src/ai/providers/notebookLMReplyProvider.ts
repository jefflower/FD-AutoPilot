import { AiReplyProvider, ReplyInput, AiStreamChunk } from '../types';
import { extractReplyArray } from '../parseUtils';
import { NotebookShadowService } from '../../services/notebookShadow';
import { AGENT_MAP } from '../../constants/agentMap';

/**
 * NotebookLM 回复 Provider
 *
 * 通过 Shadow Window 与 NotebookLM 交互，生成工单回复。
 * 使用混合 observer + relay 架构（v3）。
 */
export class NotebookLMReplyProvider implements AiReplyProvider {
    readonly name = 'notebooklm';
    private notebookId: string;
    private notebookUrl?: string;

    constructor(notebookId: string, notebookUrl?: string) {
        this.notebookId = notebookId;
        this.notebookUrl = notebookUrl;
    }

    /**
     * 从工单数据构建 AI 查询的上下文文本
     */
    private buildContext(ticket: ReplyInput['ticket']): string {
        let parsedData: any = {};
        try {
            parsedData = JSON.parse(ticket.content || '{}');
        } catch (e) { /* ignore */ }

        let context = `【TICKET SUBJECT】: ${ticket.subject}\n`;
        context += `【INITIAL DESCRIPTION】: ${parsedData?.description || 'No description content'}\n\n`;

        if (parsedData?.conversations && parsedData.conversations.length > 0) {
            context += "【DETAILED INTERACTION LOGS】:\n";
            context += "--------------------------------------------------\n";
            for (const conv of parsedData.conversations) {
                const userIdStr = String(conv.userId);
                const agentName = AGENT_MAP[userIdStr];
                const role = agentName ? `AGENT (${agentName})` : (conv.incoming ? 'CUSTOMER' : 'AGENT');
                const timeStr = conv.createdAt || 'Unknown Time';
                context += `[${timeStr}] <${role}>:\n${conv.bodyText}\n`;
                context += "--------------------------------------------------\n";
            }
        }

        return context;
    }

    async *generateReply(input: ReplyInput): AsyncGenerator<AiStreamChunk> {
        let context = this.buildContext(input.ticket);

        // 注入审核驳回反馈（如果有）
        if (input.ticket.lastAuditRemark) {
            context += "\n【PREVIOUS AUDIT FEEDBACK】:\n";
            context += `审核意见: ${input.ticket.lastAuditRemark}\n`;
            context += "请根据以上审核反馈改进你的回复，避免重复之前的问题。\n\n";
        }

        const finalPrompt = input.promptTemplate.replace('${工单内容}', context);

        const shadowService = new NotebookShadowService(this.notebookId, this.notebookUrl);

        for await (const chunk of shadowService.query(finalPrompt)) {
            yield {
                text: chunk.text,
                status: chunk.status as AiStreamChunk['status'],
            };
        }
    }

    parseReply(rawText: string): [string, string] | null {
        return extractReplyArray(rawText);
    }
}
