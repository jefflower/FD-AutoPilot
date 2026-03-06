package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

@Slf4j
@Service
public class N8nApiService {

    @Value("${n8n.api-url:http://localhost:5678}")
    private String defaultApiUrl;

    @Value("${n8n.api-key:}")
    private String defaultApiKey;

    private final RestTemplate restTemplate;

    /**
     * 通过 SPI 接口获取数据库中的 n8n 配置（由 ticket 模块实现）。
     * 使用 @Autowired(required=false) 避免在无实现时启动失败。
     */
    @Autowired(required = false)
    private N8nConfigProvider n8nConfigProvider;

    public N8nApiService() {
        this.restTemplate = new RestTemplate();
    }

    /** 解析 n8n API URL：优先数据库，fallback 到配置文件 */
    private String resolveApiUrl() {
        if (n8nConfigProvider != null) {
            try {
                String dbUrl = n8nConfigProvider.getN8nApiUrl();
                if (dbUrl != null && !dbUrl.isBlank()) {
                    return dbUrl.endsWith("/") ? dbUrl.substring(0, dbUrl.length() - 1) : dbUrl;
                }
            } catch (Exception e) {
                log.warn("[N8nApiService] 读取数据库 n8n_api_url 失败，使用默认值: {}", e.getMessage());
            }
        }
        return defaultApiUrl;
    }

    /** 解析 n8n API Key：优先数据库，fallback 到配置文件 */
    private String resolveApiKey() {
        if (n8nConfigProvider != null) {
            try {
                String dbKey = n8nConfigProvider.getN8nApiKey();
                if (dbKey != null && !dbKey.isBlank()) {
                    return dbKey;
                }
            } catch (Exception e) {
                log.warn("[N8nApiService] 读取数据库 n8n_api_key 失败，使用默认值: {}", e.getMessage());
            }
        }
        return defaultApiKey;
    }

    /**
     * 在 n8n 中创建新工作流。
     *
     * @param json 工作流 JSON 定义
     * @return n8n 返回的响应 JSON（包含 id 字段）
     */
    public String createWorkflow(String json) {
        String url = resolveApiUrl() + "/api/v1/workflows";
        try {
            HttpHeaders headers = buildHeaders();
            HttpEntity<String> entity = new HttpEntity<>(json, headers);
            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.POST, entity, String.class);
            log.info("[N8nApiService] Created workflow via n8n API, status={}", response.getStatusCode());
            return response.getBody();
        } catch (RestClientException e) {
            log.error("[N8nApiService] Failed to create workflow: {}", e.getMessage());
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "n8n API: " + e.getMessage());
        }
    }

    /**
     * 更新 n8n 中已有的工作流。
     *
     * @param n8nId n8n 工作流 ID
     * @param json  更新后的工作流 JSON
     * @return n8n 返回的响应 JSON
     */
    public String updateWorkflow(String n8nId, String json) {
        String url = resolveApiUrl() + "/api/v1/workflows/" + n8nId;
        try {
            HttpHeaders headers = buildHeaders();
            HttpEntity<String> entity = new HttpEntity<>(json, headers);
            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.PUT, entity, String.class);
            log.info("[N8nApiService] Updated workflow {}, status={}", n8nId, response.getStatusCode());
            return response.getBody();
        } catch (RestClientException e) {
            log.error("[N8nApiService] Failed to update workflow {}: {}", n8nId, e.getMessage());
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "n8n API: " + e.getMessage());
        }
    }

    /**
     * 激活 n8n 工作流。
     *
     * @param n8nId n8n 工作流 ID
     * @return n8n 返回的响应 JSON
     */
    public String activateWorkflow(String n8nId) {
        String url = resolveApiUrl() + "/api/v1/workflows/" + n8nId + "/activate";
        try {
            HttpHeaders headers = buildHeaders();
            HttpEntity<String> entity = new HttpEntity<>(null, headers);
            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.POST, entity, String.class);
            log.info("[N8nApiService] Activated workflow {}, status={}", n8nId, response.getStatusCode());
            return response.getBody();
        } catch (RestClientException e) {
            log.error("[N8nApiService] Failed to activate workflow {}: {}", n8nId, e.getMessage());
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "n8n API: " + e.getMessage());
        }
    }

    /**
     * 停用 n8n 工作流。
     *
     * @param n8nId n8n 工作流 ID
     * @return n8n 返回的响应 JSON
     */
    public String deactivateWorkflow(String n8nId) {
        String url = resolveApiUrl() + "/api/v1/workflows/" + n8nId + "/deactivate";
        try {
            HttpHeaders headers = buildHeaders();
            HttpEntity<String> entity = new HttpEntity<>(null, headers);
            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.POST, entity, String.class);
            log.info("[N8nApiService] Deactivated workflow {}, status={}", n8nId, response.getStatusCode());
            return response.getBody();
        } catch (RestClientException e) {
            log.error("[N8nApiService] Failed to deactivate workflow {}: {}", n8nId, e.getMessage());
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "n8n API: " + e.getMessage());
        }
    }

    /**
     * 获取工作流的执行记录。
     *
     * @param workflowId n8n 工作流 ID
     * @param limit      最大返回条数
     * @return n8n 返回的执行记录 JSON（{data: [...], nextCursor: ...}）
     */
    public String listExecutions(String workflowId, int limit) {
        String url = resolveApiUrl() + "/api/v1/executions?workflowId=" + workflowId + "&limit=" + limit;
        try {
            HttpHeaders headers = buildHeaders();
            HttpEntity<String> entity = new HttpEntity<>(null, headers);
            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.GET, entity, String.class);
            log.info("[N8nApiService] Listed executions for workflow {}, status={}", workflowId, response.getStatusCode());
            return response.getBody();
        } catch (RestClientException e) {
            log.error("[N8nApiService] Failed to list executions for workflow {}: {}", workflowId, e.getMessage());
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "n8n API: " + e.getMessage());
        }
    }

    /**
     * 获取 n8n 中所有工作流列表。
     *
     * @return n8n 返回的工作流列表 JSON（{data: [...]}）
     */
    public String listWorkflows() {
        String url = resolveApiUrl() + "/api/v1/workflows";
        try {
            HttpHeaders headers = buildHeaders();
            HttpEntity<String> entity = new HttpEntity<>(null, headers);
            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.GET, entity, String.class);
            log.info("[N8nApiService] Listed workflows, status={}", response.getStatusCode());
            return response.getBody();
        } catch (RestClientException e) {
            log.error("[N8nApiService] Failed to list workflows: {}", e.getMessage());
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "n8n API: " + e.getMessage());
        }
    }

    /**
     * 获取 n8n 工作流详情。
     *
     * @param n8nId n8n 工作流 ID
     * @return n8n 返回的工作流 JSON
     */
    public String getWorkflow(String n8nId) {
        String url = resolveApiUrl() + "/api/v1/workflows/" + n8nId;
        try {
            HttpHeaders headers = buildHeaders();
            HttpEntity<String> entity = new HttpEntity<>(null, headers);
            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.GET, entity, String.class);
            log.info("[N8nApiService] Fetched workflow {}, status={}", n8nId, response.getStatusCode());
            return response.getBody();
        } catch (RestClientException e) {
            log.error("[N8nApiService] Failed to get workflow {}: {}", n8nId, e.getMessage());
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "n8n API: " + e.getMessage());
        }
    }

    /**
     * 调用 n8n webhook 端点（POST）。
     * <p>
     * 自动从数据库/配置文件解析 n8n 基础地址，拼接 webhook 路径。
     * 例如 webhookPath = "fd-ai-reply" → POST http://n8n-host:5678/webhook/fd-ai-reply
     *
     * @param webhookPath webhook 路径（不含 /webhook/ 前缀）
     * @param jsonBody    请求体 JSON 字符串
     * @return 包含 url、statusCode、body 的结果 Map
     */
    public java.util.Map<String, Object> callWebhook(String webhookPath, String jsonBody) {
        java.util.Map<String, Object> result = new java.util.LinkedHashMap<>();
        String baseUrl = resolveApiUrl();
        String webhookUrl = baseUrl + "/webhook/" + webhookPath;
        result.put("url", webhookUrl);

        try {
            HttpHeaders headers = buildHeaders();

            HttpEntity<String> entity = new HttpEntity<>(jsonBody, headers);
            ResponseEntity<String> response = restTemplate.exchange(
                    webhookUrl, HttpMethod.POST, entity, String.class);

            result.put("statusCode", response.getStatusCode().value());
            String body = response.getBody();
            result.put("body", body != null && body.length() > 500 ? body.substring(0, 500) : body);

            log.info("[N8nApiService] Webhook called: url={}, status={}", webhookUrl, response.getStatusCode());
        } catch (RestClientException e) {
            result.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            log.error("[N8nApiService] Webhook call failed: url={}, error={}", webhookUrl, e.getMessage());
        }
        return result;
    }

    /**
     * 构建带 API Key 和 Content-Type 的请求头。
     */
    private HttpHeaders buildHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String apiKey = resolveApiKey();
        if (apiKey != null && !apiKey.isBlank()) {
            headers.set("X-N8N-API-KEY", apiKey);
        }
        return headers;
    }
}
