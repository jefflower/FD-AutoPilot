package com.jefflower.fdserver.ticket.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * NotebookLM CLI 封装服务。
 * 通过 ProcessBuilder 调用 notebooklm CLI 工具完成知识库源的管理操作。
 */
@Slf4j
@Service
public class NotebookLmCliService {

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 列出 notebook 中的所有源
     *
     * @param notebookId notebook UUID
     * @return 源列表（每项包含 source_id, title, type 等字段）
     */
    public List<Map<String, Object>> listSources(String notebookId) {
        List<String> command = List.of("notebooklm", "source", "list", "-n", notebookId, "--json");
        String output = executeCommand(command, 30);
        return parseJsonList(output);
    }

    /**
     * 向 notebook 添加源
     *
     * @param notebookId   notebook UUID
     * @param contentOrPath 文本内容或文件路径
     * @param type         源类型（如 pdf, text, url, csv 等）
     * @param title        源标题
     * @return 添加结果（包含 source_id 等信息）
     */
    public Map<String, Object> addSource(String notebookId, String contentOrPath, String type, String title) {
        List<String> command = new ArrayList<>();
        command.add("notebooklm");
        command.add("source");
        command.add("add");
        command.add(contentOrPath);
        command.add("-n");
        command.add(notebookId);
        if (type != null) {
            command.add("--type");
            command.add(type);
        }
        if (title != null) {
            command.add("--title");
            command.add(title);
        }
        command.add("--json");

        String output = executeCommand(command, 120);
        return parseJsonMap(output);
    }

    /**
     * 从 notebook 中删除指定源
     *
     * @param notebookId notebook UUID
     * @param sourceId   源 UUID
     */
    public void deleteSource(String notebookId, String sourceId) {
        List<String> command = List.of("notebooklm", "source", "delete", sourceId, "-n", notebookId, "-y");
        executeCommand(command, 30);
    }

    /**
     * 列出所有 notebooks
     *
     * @return notebook 列表
     */
    public List<Map<String, Object>> listNotebooks() {
        List<String> command = List.of("notebooklm", "list", "--json");
        String output = executeCommand(command, 30);
        return parseJsonList(output);
    }

    /**
     * 获取指定源的全文内容
     *
     * @param notebookId notebook UUID
     * @param sourceId   源 UUID
     * @return 源的全文内容
     */
    public String getSourceFulltext(String notebookId, String sourceId) {
        List<String> command = List.of("notebooklm", "source", "fulltext", sourceId, "-n", notebookId, "--json");
        String output = executeCommand(command, 60);
        Map<String, Object> result = parseJsonMap(output);
        if (result != null && result.containsKey("content")) {
            return String.valueOf(result.get("content"));
        }
        return output;
    }

    /**
     * 执行 CLI 命令并返回 stdout 输出
     *
     * @param command        命令及参数列表
     * @param timeoutSeconds 超时时间（秒）
     * @return stdout 输出内容
     */
    private String executeCommand(List<String> command, long timeoutSeconds) {
        log.info("[NotebookLmCli] 执行命令: {}", String.join(" ", command));
        try {
            ProcessBuilder pb = new ProcessBuilder(command);
            pb.redirectErrorStream(false);
            Process process = pb.start();

            String stdout;
            String stderr;
            try (BufferedReader stdoutReader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
                 BufferedReader stderrReader = new BufferedReader(
                         new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                stdout = stdoutReader.lines().collect(Collectors.joining("\n"));
                stderr = stderrReader.lines().collect(Collectors.joining("\n"));
            }

            boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                throw new RuntimeException("NotebookLM CLI 命令超时（" + timeoutSeconds + "秒）: " + String.join(" ", command));
            }

            int exitCode = process.exitValue();
            if (exitCode != 0) {
                log.error("[NotebookLmCli] 命令失败, exitCode={}, stderr={}", exitCode, stderr);
                throw new RuntimeException("NotebookLM CLI 命令执行失败（exitCode=" + exitCode + "）: " + stderr);
            }

            log.debug("[NotebookLmCli] 命令输出: {}", stdout);
            return stdout;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            log.error("[NotebookLmCli] 命令执行异常: {}", e.getMessage(), e);
            throw new RuntimeException("NotebookLM CLI 命令执行异常: " + e.getMessage(), e);
        }
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> parseJsonList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            log.warn("[NotebookLmCli] JSON 解析为 List 失败, 尝试解析为单对象: {}", e.getMessage());
            // 尝试解析为单个对象后包装为 List
            try {
                Map<String, Object> single = objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
                if (single.containsKey("sources")) {
                    Object sources = single.get("sources");
                    if (sources instanceof List) {
                        return (List<Map<String, Object>>) sources;
                    }
                }
                if (single.containsKey("notebooks")) {
                    Object notebooks = single.get("notebooks");
                    if (notebooks instanceof List) {
                        return (List<Map<String, Object>>) notebooks;
                    }
                }
                return List.of(single);
            } catch (Exception e2) {
                log.error("[NotebookLmCli] JSON 解析失败: {}", json, e2);
                return List.of();
            }
        }
    }

    private Map<String, Object> parseJsonMap(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            log.error("[NotebookLmCli] JSON 解析为 Map 失败: {}", json, e);
            return Map.of();
        }
    }
}
