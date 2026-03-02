package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

@Slf4j
@Service
public class N8nApiService {

    @Value("${n8n.api-url:http://localhost:5678}")
    private String n8nApiUrl;

    @Value("${n8n.api-key:}")
    private String n8nApiKey;

    private final RestTemplate restTemplate;

    public N8nApiService() {
        this.restTemplate = new RestTemplate();
    }

    /**
     * 在 n8n 中创建新工作流。
     *
     * @param json 工作流 JSON 定义
     * @return n8n 返回的响应 JSON（包含 id 字段）
     */
    public String createWorkflow(String json) {
        String url = n8nApiUrl + "/api/v1/workflows";
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
        String url = n8nApiUrl + "/api/v1/workflows/" + n8nId;
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
        String url = n8nApiUrl + "/api/v1/workflows/" + n8nId + "/activate";
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
        String url = n8nApiUrl + "/api/v1/workflows/" + n8nId + "/deactivate";
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
        String url = n8nApiUrl + "/api/v1/executions?workflowId=" + workflowId + "&limit=" + limit;
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
        String url = n8nApiUrl + "/api/v1/workflows";
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
        String url = n8nApiUrl + "/api/v1/workflows/" + n8nId;
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
     * 构建带 API Key 和 Content-Type 的请求头。
     */
    private HttpHeaders buildHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (n8nApiKey != null && !n8nApiKey.isBlank()) {
            headers.set("X-N8N-API-KEY", n8nApiKey);
        }
        return headers;
    }
}
