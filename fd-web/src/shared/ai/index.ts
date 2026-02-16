/**
 * AI Provider 模块入口
 *
 * 提供翻译和回复 Provider 的工厂函数。
 * 未来接入新的 AI 提供商时，只需：
 *   1. 在 providers/ 下新增实现类
 *   2. 在此文件的工厂函数中注册
 */

export type { AiTranslationProvider, AiReplyProvider, TranslationInput, TranslationOutput, ReplyInput, ReplyOutput, AiStreamChunk } from './types';
export { extractReplyArray } from './parseUtils';
export { GeminiTranslationProvider } from './providers/geminiTranslationProvider';
export { NotebookLMReplyProvider } from './providers/notebookLMReplyProvider';

import { AiTranslationProvider } from './types';
import { GeminiTranslationProvider } from './providers/geminiTranslationProvider';

/**
 * 获取翻译 Provider 实例
 *
 * @param name Provider 名称，默认 'gemini-cli'
 */
export function getTranslationProvider(name: string = 'gemini-cli'): AiTranslationProvider {
    switch (name) {
        case 'gemini-cli':
            return new GeminiTranslationProvider();
        default:
            console.warn(`[AI] Unknown translation provider "${name}", falling back to gemini-cli`);
            return new GeminiTranslationProvider();
    }
}

import { AiReplyProvider } from './types';
import { NotebookLMReplyProvider } from './providers/notebookLMReplyProvider';

/**
 * 获取回复 Provider 实例
 *
 * @param name Provider 名称，默认 'notebooklm'
 * @param config Provider 配置
 */
export function getReplyProvider(
    name: string = 'notebooklm',
    config?: { notebookId: string; notebookUrl?: string }
): AiReplyProvider {
    switch (name) {
        case 'notebooklm':
            if (!config?.notebookId) {
                throw new Error('NotebookLM provider requires notebookId');
            }
            return new NotebookLMReplyProvider(config.notebookId, config.notebookUrl);
        default:
            console.warn(`[AI] Unknown reply provider "${name}", falling back to notebooklm`);
            if (!config?.notebookId) {
                throw new Error('NotebookLM provider requires notebookId');
            }
            return new NotebookLMReplyProvider(config.notebookId, config.notebookUrl);
    }
}
