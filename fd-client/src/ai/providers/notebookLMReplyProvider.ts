import { AiReplyProvider, ReplyInput, AiStreamChunk } from '../types';
import { extractReplyArray } from '../parseUtils';
import { NotebookShadowService } from '../../services/notebookShadow';
import { AGENT_MAP } from '../../constants/agentMap';
import { extractTrackingNumbers, isLogisticsRelated, formatTrackingContext } from '../../services/trackingUtils';
import { TrackingShadowService } from '../../services/trackingShadow';

/**
 * NotebookLM 回复 Provider
 *
 * 通过 Shadow Window 与 NotebookLM 交互，生成工单回复。
 * 使用混合 observer + relay 架构（v3）。
 *
 * v4 扩展：支持超长内容分段输入
 * 当工单内容（对话记录较多）拼入 promptTemplate 后超过 NotebookLM 输入限制时，
 * 自动将内容按对话边界切分为多段，通过 queryMultiRound 分批发送。
 */
export class NotebookLMReplyProvider implements AiReplyProvider {
    readonly name = 'notebooklm';
    private notebookId: string;
    private notebookUrl?: string;

    /** 单条 prompt 最大长度阈值，超过则启用分段 */
    private static readonly MAX_SINGLE_PROMPT_LENGTH = 12000;
    /** 每段内容的目标大小 */
    private static readonly CHUNK_SIZE = 10000;
    /** 上下文最大长度（字符数），超出时从最旧对话开始截断 */
    private static readonly MAX_CONTEXT_LENGTH = 30000;
    /** 单条对话最大长度，超出则截断并标注 */
    private static readonly MAX_SINGLE_CONVERSATION_LENGTH = 3000;

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
            const conversations = parsedData.conversations;
            const separator = "--------------------------------------------------\n";

            // 从最新对话向最旧填充，确保最近的对话优先保留
            const formattedConvs: string[] = [];
            for (const conv of conversations) {
                const userIdStr = String(conv.userId);
                const agentName = AGENT_MAP[userIdStr];
                const role = agentName ? `AGENT (${agentName})` : (conv.incoming ? 'CUSTOMER' : 'AGENT');
                const timeStr = conv.createdAt || 'Unknown Time';

                // 截断过长的单条对话
                let bodyText = conv.bodyText || '';
                if (bodyText.length > NotebookLMReplyProvider.MAX_SINGLE_CONVERSATION_LENGTH) {
                    bodyText = bodyText.substring(0, NotebookLMReplyProvider.MAX_SINGLE_CONVERSATION_LENGTH) + '\n...[内容已截断]';
                }

                formattedConvs.push(`[${timeStr}] <${role}>:\n${bodyText}\n${separator}`);
            }

            // 计算可用空间并截断最旧的对话
            const header = "【DETAILED INTERACTION LOGS】:\n" + separator;
            const availableLength = NotebookLMReplyProvider.MAX_CONTEXT_LENGTH - context.length - header.length;

            let totalLength = 0;
            let startIndex = 0;

            // 从最新（末尾）向最旧（开头）累加，找到能放入的起始索引
            for (let i = formattedConvs.length - 1; i >= 0; i--) {
                if (totalLength + formattedConvs[i].length > availableLength) {
                    startIndex = i + 1;
                    break;
                }
                totalLength += formattedConvs[i].length;
            }

            context += header;

            if (startIndex > 0) {
                const skipped = startIndex;
                console.log(`[NotebookLMReplyProvider] Truncating ${skipped} oldest conversation(s) to fit context limit`);
                context += `[... 已省略最早的 ${skipped} 条对话记录 ...]\n${separator}`;
            }

            for (let i = startIndex; i < formattedConvs.length; i++) {
                context += formattedConvs[i];
            }
        }

        return context;
    }

    /**
     * 按对话边界将内容切分为多段
     *
     * 优先在分隔线处切分，保持对话完整性。
     * 如果某段仍然超过 maxChunkSize，则按字符强制切分。
     */
    private splitByBoundary(text: string, maxChunkSize: number): string[] {
        const separator = '--------------------------------------------------';
        const sections = text.split(separator);
        const chunks: string[] = [];
        let current = '';

        for (const section of sections) {
            if (current.length + section.length + separator.length > maxChunkSize && current.length > 0) {
                chunks.push(current.trim());
                current = section;
            } else {
                current += (current ? separator : '') + section;
            }
        }
        if (current.trim()) chunks.push(current.trim());

        // 如果某段仍然超限，按字符强制切分
        const result: string[] = [];
        for (const chunk of chunks) {
            if (chunk.length <= maxChunkSize) {
                result.push(chunk);
            } else {
                for (let i = 0; i < chunk.length; i += maxChunkSize) {
                    result.push(chunk.substring(i, i + maxChunkSize));
                }
            }
        }
        return result;
    }

    /**
     * 根据内容长度决定构建单条或多条消息
     *
     * 当 finalPrompt 不超过阈值时返回单条消息（走原有 query）；
     * 超过时拆分为：前言 → 分段内容 → 结束指令，走 queryMultiRound。
     */
    private buildMessages(context: string, promptTemplate: string): string[] {
        const finalPrompt = promptTemplate.replace('${工单内容}', context);

        if (finalPrompt.length <= NotebookLMReplyProvider.MAX_SINGLE_PROMPT_LENGTH) {
            return [finalPrompt];
        }

        console.log(`[NotebookLMReplyProvider] Content too long (${finalPrompt.length} chars), splitting into multi-round messages`);

        // 提取指令部分（promptTemplate 中去掉 ${工单内容} 占位符后的内容）
        const instruction = promptTemplate.replace('${工单内容}', '').trim();

        const messages: string[] = [];

        // 第1条：前言，告知 AI 将分段发送
        messages.push(
            "I will send you ticket content in multiple parts. " +
            "Please reply with just 'OK' after receiving each part. " +
            "DO NOT generate the final reply until I send the message starting with '[END_OF_INPUT]'."
        );

        // 中间：内容分段（按对话边界切分）
        const chunks = this.splitByBoundary(context, NotebookLMReplyProvider.CHUNK_SIZE);
        console.log(`[NotebookLMReplyProvider] Split into ${chunks.length} chunks`);
        chunks.forEach((chunk, i) => {
            messages.push(`[Part ${i + 1}/${chunks.length}]\n${chunk}`);
        });

        // 最后：结束标记 + 指令
        messages.push(
            `[END_OF_INPUT]\n\nAll ticket content has been sent. Now please follow the instruction below:\n\n${instruction}`
        );

        console.log(`[NotebookLMReplyProvider] Total messages: ${messages.length} (1 preamble + ${chunks.length} chunks + 1 final instruction)`);
        return messages;
    }

    async *generateReply(input: ReplyInput): AsyncGenerator<AiStreamChunk> {
        let context = this.buildContext(input.ticket);

        // 注入审核驳回反馈（如果有）
        if (input.ticket.lastAuditRemark) {
            context += "\n【PREVIOUS AUDIT FEEDBACK】:\n";
            context += `审核意见: ${input.ticket.lastAuditRemark}\n`;
            context += "请根据以上审核反馈改进你的回复，避免重复之前的问题。\n\n";
        }

        // 物流信息自动注入：有运单号 AND 是物流相关工单时才查询
        try {
            const trackingNumbers = extractTrackingNumbers(context);
            if (trackingNumbers.length > 0 && isLogisticsRelated(input.ticket.subject, context)) {
                console.log(`[NotebookLMReplyProvider] Detected logistics ticket with ${trackingNumbers.length} tracking number(s), querying...`);
                yield { text: '', status: 'streaming' }; // 通知前端开始处理

                const trackingService = new TrackingShadowService();
                const trackingResults = await trackingService.queryMultiple(trackingNumbers.slice(0, 3)); // 最多查 3 个
                const trackingContext = formatTrackingContext(trackingResults);
                if (trackingContext) {
                    context += trackingContext;
                    console.log(`[NotebookLMReplyProvider] Logistics context injected (${trackingContext.length} chars)`);
                }
            }
        } catch (err) {
            console.warn('[NotebookLMReplyProvider] Logistics query failed, proceeding without:', err);
            // 物流查询失败不阻塞回复生成
        }

        const messages = this.buildMessages(context, input.promptTemplate);

        const shadowService = new NotebookShadowService(this.notebookId, this.notebookUrl);

        if (messages.length === 1) {
            // 不超限，走原有单轮
            for await (const chunk of shadowService.query(messages[0])) {
                yield {
                    text: chunk.text,
                    status: chunk.status as AiStreamChunk['status'],
                };
            }
        } else {
            // 超限，走多轮分段
            for await (const chunk of shadowService.queryMultiRound(messages)) {
                yield {
                    text: chunk.text,
                    status: chunk.status as AiStreamChunk['status'],
                };
            }
        }
    }

    parseReply(rawText: string): [string, string] | null {
        return extractReplyArray(rawText);
    }
}
