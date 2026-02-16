/**
 * AI 响应解析工具
 *
 * 从 AI 输出的原始文本中提取结构化数据。
 */

/**
 * 从 AI 回复文本中提取 JSON 字符串数组 ["回复1", "回复2"]
 *
 * 策略：
 * 1. 从后往前搜索 `]`，再向前搜索 `[`，逐一尝试 JSON.parse
 *    - 快速预检：`[` 后紧跟 `"` 才尝试解析（跳过 [timestamp] 格式）
 * 2. Fallback: 简单的 indexOf/lastIndexOf 截取
 * 3. 最终 Fallback: 正则匹配 `["str1", "str2"]` 模式
 */
export function extractReplyArray(text: string): [string, string] | null {
    const trimmed = text.trim();

    // 策略 1: 从后往前精确搜索
    let jsonStr: string | null = null;
    const lastBracket = trimmed.lastIndexOf(']');
    if (lastBracket !== -1) {
        for (let i = lastBracket - 1; i >= 0; i--) {
            if (trimmed[i] === '[') {
                const candidate = trimmed.substring(i, lastBracket + 1);
                const afterBracket = candidate.substring(1).trimStart();
                if (!afterBracket.startsWith('"')) continue;
                try {
                    const test = JSON.parse(candidate);
                    if (Array.isArray(test) && test.length >= 2 && typeof test[0] === 'string') {
                        jsonStr = candidate;
                        break;
                    }
                } catch {
                    // 继续往前搜索
                }
            }
        }
    }

    let textToParse = jsonStr || trimmed;

    // 策略 2: Fallback — 简单截取
    if (!jsonStr) {
        const startIdx = textToParse.indexOf('[');
        const endIdx = textToParse.lastIndexOf(']');
        if (startIdx !== -1 && endIdx > startIdx) {
            textToParse = textToParse.substring(startIdx, endIdx + 1);
        }
    }

    // 尝试解析
    try {
        const parsed = JSON.parse(textToParse);
        if (Array.isArray(parsed) && parsed.length >= 2 && typeof parsed[0] === 'string') {
            return [parsed[0], parsed[1]];
        }
    } catch {
        // 策略 3: 正则后备
        const match = textToParse.match(/\[\s*"([\s\S]*?)"\s*,\s*"([\s\S]*?)"\s*\]/);
        if (match) {
            const str1 = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
            const str2 = match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
            return [str1, str2];
        }
    }

    return null;
}
