package com.jefflower.fdserver.ai.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ai.dto.AgentExecuteResult;
import com.jefflower.fdserver.ai.dto.AgentProxyTestResult;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.ai.service.AgentProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 通用 HTTP API Agent Provider
 *
 * 支持 OpenAI/Claude 等标准 Chat Completion API。
 * 从 providerConfig 读取 baseUrl, model, apiKey, maxTokens, systemPrompt。
 */
@Component
public class HttpApiAgentProvider implements AgentProvider {

    private static final Logger log = LoggerFactory.getLogger(HttpApiAgentProvider.class);
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    public HttpApiAgentProvider(RestTemplate restTemplate, ObjectMapper objectMapper) {
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public ProviderType getProviderType() {
        return ProviderType.HTTP_API;
    }

    @Override
    public AgentExecuteResult execute(String input, Map<String, Object> config) {
        String baseUrl = (String) config.getOrDefault("baseUrl", "");
        String model = (String) config.getOrDefault("model", "gpt-4o-mini");
        String apiKey = (String) config.getOrDefault("apiKey", "");
        int maxTokens = config.containsKey("maxTokens") ? ((Number) config.get("maxTokens")).intValue() : 4096;
        String systemPrompt = (String) config.getOrDefault("systemPrompt", "");

        if (baseUrl.isEmpty()) {
            return new AgentExecuteResult(false, null, null, "HTTP API Agent 缺少 baseUrl 配置");
        }

        try {
            String endpoint = baseUrl.endsWith("/") ? baseUrl + "chat/completions" : baseUrl + "/chat/completions";

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            if (!apiKey.isEmpty()) {
                headers.setBearerAuth(apiKey);
            }

            Map<String, Object> requestBody = Map.of(
                    "model", model,
                    "max_tokens", maxTokens,
                    "messages", buildMessages(systemPrompt, input)
            );

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
            ResponseEntity<String> response = restTemplate.exchange(endpoint, HttpMethod.POST, entity, String.class);

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                JsonNode root = objectMapper.readTree(response.getBody());
                String content = root.path("choices").path(0).path("message").path("content").asText("");
                Integer tokenCount = null;
                JsonNode usage = root.path("usage");
                if (!usage.isMissingNode()) {
                    tokenCount = usage.path("total_tokens").asInt(0);
                }
                return new AgentExecuteResult(true, content, tokenCount, null);
            } else {
                return new AgentExecuteResult(false, null, null, "HTTP API 返回状态: " + response.getStatusCode());
            }
        } catch (Exception e) {
            log.error("[HttpApiAgentProvider] Execution failed", e);
            return new AgentExecuteResult(false, null, null, e.getMessage());
        }
    }

    /**
     * 测试代理服务器连通性并获取可用模型列表
     */
    public AgentProxyTestResult testProxy(String baseUrl, String apiKey) {
        if (baseUrl == null || baseUrl.isBlank()) {
            return new AgentProxyTestResult(false, List.of(), "baseUrl 不能为空");
        }

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(3000);
        factory.setReadTimeout(5000);
        RestTemplate shortTimeoutTemplate = new RestTemplate(factory);

        String normalizedUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;

        // 尝试 /models 路径（兼容 /v1/models 和 /models）
        String[] modelsPaths = {normalizedUrl + "/models", normalizedUrl + "/v1/models"};

        for (String modelsUrl : modelsPaths) {
            try {
                HttpHeaders headers = new HttpHeaders();
                if (apiKey != null && !apiKey.isBlank()) {
                    headers.setBearerAuth(apiKey);
                }

                HttpEntity<Void> entity = new HttpEntity<>(headers);
                ResponseEntity<String> response = shortTimeoutTemplate.exchange(
                        modelsUrl, HttpMethod.GET, entity, String.class);

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    JsonNode root = objectMapper.readTree(response.getBody());
                    JsonNode dataArray = root.path("data");
                    List<String> models = new ArrayList<>();
                    if (dataArray.isArray()) {
                        for (JsonNode modelNode : dataArray) {
                            String modelId = modelNode.path("id").asText("");
                            if (!modelId.isEmpty()) {
                                models.add(modelId);
                            }
                        }
                    }
                    return new AgentProxyTestResult(true, models, null);
                }
            } catch (Exception e) {
                log.debug("[HttpApiAgentProvider] testProxy failed for {}: {}", modelsUrl, e.getMessage());
            }
        }

        return new AgentProxyTestResult(false, List.of(),
                "无法连接到代理服务器 " + normalizedUrl + "，请确认代理已启动");
    }

    private List<Map<String, String>> buildMessages(String systemPrompt, String userInput) {
        if (systemPrompt != null && !systemPrompt.isEmpty()) {
            return List.of(
                    Map.of("role", "system", "content", systemPrompt),
                    Map.of("role", "user", "content", userInput)
            );
        }
        return List.of(Map.of("role", "user", "content", userInput));
    }
}
