package com.jefflower.fdserver.ticket.util;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 工单内容降噪工具
 *
 * 在 Freshdesk 数据同步时对 description 和 conversation bodyText 进行清洗：
 * 1. 移除 HTML 标签（保留纯文本）
 * 2. 缩短超长 URL
 * 3. 移除邮件引用链
 * 4. 压缩连续空行
 *
 * 清洗后的数据直接保存到数据库，后续翻译和回复 Agent 使用已降噪的内容，节省 token。
 */
public final class ContentCleaner {

    private ContentCleaner() {
    }

    // ========== 正则预编译 ==========

    private static final Pattern BR_TAG = Pattern.compile("<br\\s*/?>", Pattern.CASE_INSENSITIVE);
    private static final Pattern P_CLOSE = Pattern.compile("</p>", Pattern.CASE_INSENSITIVE);
    private static final Pattern DIV_CLOSE = Pattern.compile("</div>", Pattern.CASE_INSENSITIVE);
    private static final Pattern LI_OPEN = Pattern.compile("<li[^>]*>", Pattern.CASE_INSENSITIVE);
    private static final Pattern ALL_TAGS = Pattern.compile("<[^>]+>");
    private static final Pattern LONG_URL = Pattern.compile("https?://[^\\s)<>\"\\]]+");
    private static final Pattern BLANK_LINES = Pattern.compile("\n{4,}");

    // 邮件引用头
    private static final Pattern QUOTE_EN = Pattern.compile("^On\\s+.{10,80}\\s+wrote:\\s*$", Pattern.CASE_INSENSITIVE);
    private static final Pattern QUOTE_CN = Pattern.compile("^在\\s*.{5,60}\\s*写道[：:]");
    private static final Pattern FORWARD = Pattern.compile("^-{5,}\\s*(Forwarded|Original)\\s+(message|Message)", Pattern.CASE_INSENSITIVE);
    private static final Pattern QUOTE_LINE = Pattern.compile("^>{1,}\\s?");
    // 分割线：连续 5+ 个相同特殊字符组成的行（>>>、===、---、___、*** 等）
    private static final Pattern SEPARATOR_LINE = Pattern.compile("^[>=\\-_*~#]{5,}\\s*$");

    // HTML 实体
    private static final Pattern ENTITY_NBSP = Pattern.compile("&nbsp;", Pattern.CASE_INSENSITIVE);
    private static final Pattern ENTITY_AMP = Pattern.compile("&amp;", Pattern.CASE_INSENSITIVE);
    private static final Pattern ENTITY_LT = Pattern.compile("&lt;", Pattern.CASE_INSENSITIVE);
    private static final Pattern ENTITY_GT = Pattern.compile("&gt;", Pattern.CASE_INSENSITIVE);
    private static final Pattern ENTITY_QUOT = Pattern.compile("&quot;", Pattern.CASE_INSENSITIVE);
    private static final Pattern ENTITY_APOS1 = Pattern.compile("&#39;");
    private static final Pattern ENTITY_APOS2 = Pattern.compile("&apos;", Pattern.CASE_INSENSITIVE);
    private static final Pattern ENTITY_APOS3 = Pattern.compile("&#x27;", Pattern.CASE_INSENSITIVE);
    private static final Pattern ENTITY_NUMERIC = Pattern.compile("&#(\\d+);");

    /**
     * 对文本执行全部降噪处理
     */
    public static String clean(String text) {
        if (text == null || text.isBlank()) {
            return text == null ? "" : text;
        }

        String result = text;
        // 统一换行符：\r\n → \n，残留 \r → \n
        result = result.replace("\r\n", "\n").replace("\r", "\n");
        result = stripHtml(result);
        result = shortenUrls(result);
        result = removeEmailQuotes(result);
        result = compressBlankLines(result);
        return result.trim();
    }

    // ========== Step 1: HTML 清洗 ==========

    static String stripHtml(String text) {
        String result = text;

        // <br> → 换行
        result = BR_TAG.matcher(result).replaceAll("\n");
        // </p> → 换行
        result = P_CLOSE.matcher(result).replaceAll("\n");
        // </div> → 换行
        result = DIV_CLOSE.matcher(result).replaceAll("\n");
        // <li> → "- "
        result = LI_OPEN.matcher(result).replaceAll("\n- ");
        // 移除所有剩余标签
        result = ALL_TAGS.matcher(result).replaceAll("");

        // 解码 HTML 实体
        result = ENTITY_NBSP.matcher(result).replaceAll(" ");
        result = ENTITY_AMP.matcher(result).replaceAll("&");
        result = ENTITY_LT.matcher(result).replaceAll("<");
        result = ENTITY_GT.matcher(result).replaceAll(">");
        result = ENTITY_QUOT.matcher(result).replaceAll("\"");
        result = ENTITY_APOS1.matcher(result).replaceAll("'");
        result = ENTITY_APOS2.matcher(result).replaceAll("'");
        result = ENTITY_APOS3.matcher(result).replaceAll("'");
        result = ENTITY_NUMERIC.matcher(result).replaceAll(mr -> {
            try {
                int codePoint = Integer.parseInt(mr.group(1));
                return String.valueOf((char) codePoint);
            } catch (NumberFormatException e) {
                return mr.group();
            }
        });

        return result;
    }

    // ========== Step 2: URL 缩短 ==========

    static String shortenUrls(String text) {
        Matcher m = LONG_URL.matcher(text);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String url = m.group();
            String replacement;
            if (url.length() <= 80) {
                replacement = Matcher.quoteReplacement(url);
            } else {
                try {
                    String host = URI.create(url).getHost();
                    replacement = "[链接: " + (host != null ? host : "...") + "]";
                } catch (Exception e) {
                    replacement = Matcher.quoteReplacement(url.substring(0, Math.min(60, url.length())) + "...");
                }
            }
            m.appendReplacement(sb, replacement);
        }
        m.appendTail(sb);
        return sb.toString();
    }

    // ========== Step 3: 邮件引用移除 ==========

    static String removeEmailQuotes(String text) {
        String[] lines = text.split("\n", -1);
        List<String> result = new ArrayList<>();
        boolean inQuoteBlock = false;
        boolean quoteReplaced = false;

        for (String line : lines) {
            String trimmed = line.trim();

            // "On ... wrote:" 格式
            if (QUOTE_EN.matcher(trimmed).matches()) {
                if (!quoteReplaced) {
                    quoteReplaced = true;
                }
                inQuoteBlock = true;
                continue;
            }

            // 中文 "在 ... 写道："
            if (QUOTE_CN.matcher(trimmed).find()) {
                if (!quoteReplaced) {
                    quoteReplaced = true;
                }
                inQuoteBlock = true;
                continue;
            }

            // 转发标记
            if (FORWARD.matcher(trimmed).find()) {
                if (!quoteReplaced) {
                    quoteReplaced = true;
                }
                inQuoteBlock = true;
                continue;
            }

            // ">" 开头的引用行
            if (QUOTE_LINE.matcher(trimmed).find()) {
                if (!inQuoteBlock && !quoteReplaced) {
                    quoteReplaced = true;
                }
                inQuoteBlock = true;
                continue;
            }

            // 分割线（>>>>>>、=====、-----、_____ 等）直接删除
            if (SEPARATOR_LINE.matcher(trimmed).matches()) {
                continue;
            }

            // 引用块内的空行继续跳过
            if (inQuoteBlock && trimmed.isEmpty()) {
                continue;
            }

            // 非引用行：退出引用块
            if (inQuoteBlock) {
                inQuoteBlock = false;
                quoteReplaced = false;
            }

            result.add(line);
        }

        return String.join("\n", result);
    }

    // ========== Step 4: 空行压缩 ==========

    static String compressBlankLines(String text) {
        return BLANK_LINES.matcher(text).replaceAll("\n\n\n");
    }
}
