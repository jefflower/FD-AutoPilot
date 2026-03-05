/**
 * 工单内容清洗工具
 *
 * 用于 AI 输入前预处理，去除冗余信息以减少 token 消耗。
 * 只影响发送给 AI 的文本，不修改数据库中的原始数据。
 */

/**
 * 移除 HTML 标签，保留文本内容
 *
 * - <br> / <br/> / <br /> 替换为换行符
 * - <p>...</p> 末尾追加换行
 * - 其余标签直接剥离
 * - 解码常见 HTML 实体
 */
function stripHtml(text: string): string {
    let result = text;

    // <br> 系列 → 换行
    result = result.replace(/<br\s*\/?>/gi, '\n');

    // <p> 结束标签 → 换行（保证段落间有间距）
    result = result.replace(/<\/p>/gi, '\n');

    // <div> 结束标签 → 换行
    result = result.replace(/<\/div>/gi, '\n');

    // <li> → 换行 + "- "
    result = result.replace(/<li[^>]*>/gi, '\n- ');

    // 移除所有剩余 HTML 标签
    result = result.replace(/<[^>]+>/g, '');

    // 解码常见 HTML 实体
    result = result.replace(/&nbsp;/gi, ' ');
    result = result.replace(/&amp;/gi, '&');
    result = result.replace(/&lt;/gi, '<');
    result = result.replace(/&gt;/gi, '>');
    result = result.replace(/&quot;/gi, '"');
    result = result.replace(/&#39;/gi, "'");
    result = result.replace(/&apos;/gi, "'");
    result = result.replace(/&#x27;/gi, "'");
    result = result.replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));

    return result;
}

/**
 * 缩短超长 URL
 *
 * 长度 > 80 的 URL 替换为 [链接: domain.com]，短 URL 保留原样。
 */
function shortenUrls(text: string): string {
    return text.replace(/https?:\/\/[^\s)<>"\]]+/g, (url) => {
        if (url.length <= 80) {
            return url;
        }
        try {
            const hostname = new URL(url).hostname;
            return `[链接: ${hostname}]`;
        } catch {
            // URL 解析失败时做简单截断
            return url.substring(0, 60) + '...';
        }
    });
}

/**
 * 移除邮件引用链
 *
 * 匹配模式：
 * 1. "On <日期时间> <作者> wrote:" 类引用头（英文）
 * 2. "<日期> <时间>, <作者> 写道：" 类引用头（中文）
 * 3. "---------- Forwarded message ----------" 转发标记
 * 4. 连续 ">" 开头的引用行块
 *
 * 从匹配行开始，删除后续连续的引用内容，替换为省略标记。
 */
function removeEmailQuotes(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let inQuoteBlock = false;
    let quoteReplaced = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // 检测引用头 — "On ... wrote:" 格式（英文，兼容多行）
        if (/^On\s+.{10,80}\s+wrote:\s*$/i.test(trimmed)) {
            if (!quoteReplaced) {
                quoteReplaced = true;
            }
            inQuoteBlock = true;
            continue;
        }

        // 检测引用头 — 中文 "在 ... 写道："
        if (/^在\s*.{5,60}\s*写道[：:]/.test(trimmed)) {
            if (!quoteReplaced) {
                quoteReplaced = true;
            }
            inQuoteBlock = true;
            continue;
        }

        // 检测转发标记
        if (/^-{5,}\s*(Forwarded|Original)\s+(message|Message)/i.test(trimmed)) {
            if (!quoteReplaced) {
                quoteReplaced = true;
            }
            inQuoteBlock = true;
            continue;
        }

        // 分割线（>>>>>>、=====、-----、_____ 等）直接删除
        if (/^[>=\-_*~#]{5,}\s*$/.test(trimmed)) {
            continue;
        }

        // 检测 ">" 开头的引用行
        if (/^>{1,}\s?/.test(trimmed)) {
            if (!inQuoteBlock && !quoteReplaced) {
                quoteReplaced = true;
            }
            inQuoteBlock = true;
            continue;
        }

        // 如果在引用块内，空行继续跳过（引用块的间隔）
        if (inQuoteBlock && trimmed === '') {
            continue;
        }

        // 非引用行：退出引用块
        if (inQuoteBlock) {
            inQuoteBlock = false;
            // 不重置 quoteReplaced — 后续如果有新的引用块，会被新的省略标记替换
            quoteReplaced = false;
        }

        result.push(line);
    }

    return result.join('\n');
}

/**
 * 压缩连续空白行
 *
 * 3 个及以上连续空行合并为 2 个。
 */
function compressBlankLines(text: string): string {
    return text.replace(/\n{4,}/g, '\n\n\n');
}

/**
 * 清洗工单文本内容，去除冗余信息以减少 AI 输入长度
 *
 * 处理顺序：
 * 1. 移除 HTML 标签（保留文本内容）
 * 2. 缩短长 URL（只保留域名部分）
 * 3. 移除邮件引用链（On ... wrote: 及其后续引用内容）
 * 4. 压缩连续空白行
 *
 * 只用于 AI 输入预处理，不修改原始数据。
 */
export function cleanTextForAi(text: string): string {
    if (!text) return '';

    let result = text;

    // Step 0: 统一换行符
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Step 1: 清理 HTML
    result = stripHtml(result);

    // Step 2: 缩短超长 URL
    result = shortenUrls(result);

    // Step 3: 移除邮件引用链
    result = removeEmailQuotes(result);

    // Step 4: 压缩空白行
    result = compressBlankLines(result);

    // 最终 trim
    return result.trim();
}
