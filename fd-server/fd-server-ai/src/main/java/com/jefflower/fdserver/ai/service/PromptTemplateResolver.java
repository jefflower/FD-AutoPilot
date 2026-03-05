package com.jefflower.fdserver.ai.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 提示词模板解析器（服务端统一入口）。
 * <p>
 * 支持两种语法：
 * <ul>
 *   <li>变量替换：{@code {{key}}} → 替换为变量值</li>
 *   <li>条件块：{@code {{#if key}}...内容...{{/if}}} → 变量非空时保留块内容，否则整块移除</li>
 * </ul>
 * <p>
 * Object 类型的变量自动序列化为带缩进的 JSON（与前端 JSON.stringify(v, null, 2) 对齐）。
 */
@Component
public class PromptTemplateResolver {

    private static final Pattern IF_BLOCK_PATTERN = Pattern.compile(
            "\\{\\{#if\\s+(\\w+)\\}\\}([\\s\\S]*?)\\{\\{/if\\}\\}");

    private final ObjectMapper objectMapper;

    public PromptTemplateResolver(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * 解析模板，将 {{key}} 替换为变量值，处理 {{#if key}}...{{/if}} 条件块。
     *
     * @param template  提示词模板（可包含 {{key}} 和 {{#if key}}...{{/if}} 语法）
     * @param variables 变量映射（key → Object，自动转 String）
     * @return 解析后的完整提示词
     */
    public String resolve(String template, Map<String, Object> variables) {
        if (template == null || template.isBlank()) return "";
        if (variables == null || variables.isEmpty()) return template;

        // 预处理：将所有变量值转为 String
        Map<String, String> stringVars = toStringMap(variables);

        String result = template;

        // 1. 处理条件块：{{#if key}}...{{/if}}
        Matcher matcher = IF_BLOCK_PATTERN.matcher(result);
        StringBuilder sb = new StringBuilder();
        while (matcher.find()) {
            String key = matcher.group(1);
            String content = matcher.group(2);
            String val = stringVars.get(key);
            boolean hasValue = val != null && !val.isEmpty();
            matcher.appendReplacement(sb, Matcher.quoteReplacement(hasValue ? content : ""));
        }
        matcher.appendTail(sb);
        result = sb.toString();

        // 2. 替换普通变量：{{key}}
        for (Map.Entry<String, String> entry : stringVars.entrySet()) {
            result = result.replace("{{" + entry.getKey() + "}}", entry.getValue());
        }

        return result;
    }

    /**
     * 将 Object 变量映射转为 String 映射。
     * null → ""，String → 原值，其他 → JSON（带缩进）。
     */
    private Map<String, String> toStringMap(Map<String, Object> variables) {
        Map<String, String> stringVars = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : variables.entrySet()) {
            Object raw = entry.getValue();
            String value;
            if (raw == null) {
                value = "";
            } else if (raw instanceof String s) {
                value = s;
            } else {
                try {
                    // 带缩进序列化，与前端 JSON.stringify(v, null, 2) 对齐
                    value = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(raw);
                } catch (JsonProcessingException e) {
                    value = raw.toString();
                }
            }
            stringVars.put(entry.getKey(), value);
        }
        return stringVars;
    }
}
