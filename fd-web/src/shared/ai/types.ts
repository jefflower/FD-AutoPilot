import { ServerTicket, TranslationSubmitData, ReplySubmitData } from '../types/server';

/**
 * AI Provider 接口定义
 *
 * 翻译和回复功能的抽象层，支持快速切换不同 AI 提供商。
 * 当前实现：
 *   - 翻译: GeminiTranslationProvider (Gemini CLI)
 *   - 回复: NotebookLMReplyProvider (NotebookLM Shadow Window)
 */

// ============ 通用类型 ============

/** AI 流式响应 chunk */
export interface AiStreamChunk {
    text: string;
    status: 'streaming' | 'complete' | 'error';
}

// ============ 翻译 Provider ============

/** 翻译 Provider 输入 */
export interface TranslationInput {
    ticket: ServerTicket;
    targetLang: string;
}

/** 翻译 Provider 输出（与 TranslationSubmitData 对齐） */
export type TranslationOutput = TranslationSubmitData;

/** AI 翻译 Provider 接口 */
export interface AiTranslationProvider {
    readonly name: string;
    translate(input: TranslationInput): Promise<TranslationOutput>;
}

// ============ 回复 Provider ============

/** 回复 Provider 输入 */
export interface ReplyInput {
    ticket: ServerTicket;
    promptTemplate: string;
}

/** 回复 Provider 输出（与 ReplySubmitData 对齐） */
export type ReplyOutput = ReplySubmitData;

/** AI 回复 Provider 接口 */
export interface AiReplyProvider {
    readonly name: string;
    generateReply(input: ReplyInput): AsyncGenerator<AiStreamChunk>;
    parseReply(rawText: string): [string, string] | null;
}
