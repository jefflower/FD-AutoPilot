import { describe, it, expect } from 'vitest';
import { extractReplyArray } from './parseUtils';

describe('extractReplyArray', () => {
  it('解析标准 JSON 字符串数组', () => {
    const input = '["Hello, this is reply", "你好，这是回复"]';
    const result = extractReplyArray(input);
    expect(result).toEqual(['Hello, this is reply', '你好，这是回复']);
  });

  it('解析带前缀噪声文本的 JSON', () => {
    const input = 'Here is the reply:\n["Reply in English", "中文回复"]';
    const result = extractReplyArray(input);
    expect(result).toEqual(['Reply in English', '中文回复']);
  });

  it('解析带后缀文本的 JSON', () => {
    const input = '["first", "second"] some trailing text';
    const result = extractReplyArray(input);
    expect(result).toEqual(['first', 'second']);
  });

  it('处理包含换行符的内容', () => {
    const input = '["line1\\nline2", "行1\\n行2"]';
    const result = extractReplyArray(input);
    expect(result).not.toBeNull();
    expect(result![0]).toContain('line1');
  });

  it('处理超过 2 个元素的数组（取前两个）', () => {
    const input = '["a", "b", "c"]';
    const result = extractReplyArray(input);
    expect(result).toEqual(['a', 'b']);
  });

  it('返回 null：空字符串', () => {
    expect(extractReplyArray('')).toBeNull();
  });

  it('返回 null：非数组 JSON', () => {
    expect(extractReplyArray('{"key": "value"}')).toBeNull();
  });

  it('返回 null：只有一个元素的数组', () => {
    expect(extractReplyArray('["only one"]')).toBeNull();
  });

  it('返回 null：纯文本无 JSON', () => {
    expect(extractReplyArray('just some plain text')).toBeNull();
  });

  it('跳过 [timestamp] 格式的方括号', () => {
    const input = '[2024-01-01] Log entry\n["actual reply", "真实回复"]';
    const result = extractReplyArray(input);
    expect(result).toEqual(['actual reply', '真实回复']);
  });

  it('处理包含转义引号的内容', () => {
    const input = '["He said \\"hello\\"", "他说\\"你好\\""]';
    const result = extractReplyArray(input);
    expect(result).not.toBeNull();
    expect(result![0]).toContain('hello');
  });
});
