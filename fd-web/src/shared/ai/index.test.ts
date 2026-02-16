import { describe, it, expect } from 'vitest';
import { getTranslationProvider, getReplyProvider } from './index';
import { GeminiTranslationProvider } from './providers/geminiTranslationProvider';
import { NotebookLMReplyProvider } from './providers/notebookLMReplyProvider';

describe('getTranslationProvider', () => {
  it('返回 GeminiTranslationProvider（默认）', () => {
    const provider = getTranslationProvider();
    expect(provider).toBeInstanceOf(GeminiTranslationProvider);
    expect(provider.name).toBe('gemini-cli');
  });

  it('指定 gemini-cli 返回 GeminiTranslationProvider', () => {
    const provider = getTranslationProvider('gemini-cli');
    expect(provider).toBeInstanceOf(GeminiTranslationProvider);
  });

  it('未知 provider 名称 fallback 到 GeminiTranslationProvider', () => {
    const provider = getTranslationProvider('unknown-provider');
    expect(provider).toBeInstanceOf(GeminiTranslationProvider);
  });
});

describe('getReplyProvider', () => {
  const validConfig = { notebookId: 'test-notebook-id' };

  it('返回 NotebookLMReplyProvider（默认）', () => {
    const provider = getReplyProvider('notebooklm', validConfig);
    expect(provider).toBeInstanceOf(NotebookLMReplyProvider);
    expect(provider.name).toBe('notebooklm');
  });

  it('缺少 notebookId 时抛出错误', () => {
    expect(() => getReplyProvider('notebooklm')).toThrow('notebookId');
  });

  it('空 notebookId 时抛出错误', () => {
    expect(() => getReplyProvider('notebooklm', { notebookId: '' })).toThrow('notebookId');
  });

  it('未知 provider fallback 到 NotebookLM', () => {
    const provider = getReplyProvider('unknown', validConfig);
    expect(provider).toBeInstanceOf(NotebookLMReplyProvider);
  });

  it('传入 notebookUrl 不抛错', () => {
    const provider = getReplyProvider('notebooklm', {
      notebookId: 'test-id',
      notebookUrl: 'https://notebooklm.google.com/notebook/test-id',
    });
    expect(provider).toBeInstanceOf(NotebookLMReplyProvider);
  });
});
