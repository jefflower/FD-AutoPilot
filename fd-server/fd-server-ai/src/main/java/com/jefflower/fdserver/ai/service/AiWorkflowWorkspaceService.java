package com.jefflower.fdserver.ai.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.jefflower.fdserver.ai.entity.AiWorkflowWorkspace;
import com.jefflower.fdserver.ai.repository.AiWorkflowWorkspaceRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.util.Iterator;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class AiWorkflowWorkspaceService {

    private final AiWorkflowWorkspaceRepository workspaceRepository;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;

    @Value("${server.port:9988}")
    private int serverPort;

    public AiWorkflowWorkspaceService(AiWorkflowWorkspaceRepository workspaceRepository,
                                       ObjectMapper objectMapper) {
        this.workspaceRepository = workspaceRepository;
        this.objectMapper = objectMapper;
        this.restTemplate = new RestTemplate();
    }

    /**
     * 获取工作流的所有工作区文档。
     */
    public List<AiWorkflowWorkspace> getWorkspaceDocs(Long workflowId) {
        return workspaceRepository.findByWorkflowIdOrderBySortOrder(workflowId);
    }

    /**
     * 添加工作区文档。
     */
    @Transactional
    public AiWorkflowWorkspace addDoc(Long workflowId, String docType, String docTitle,
                                       String swaggerGroup, String docContent, int sortOrder) {
        AiWorkflowWorkspace doc = new AiWorkflowWorkspace();
        doc.setWorkflowId(workflowId);
        doc.setDocType(docType);
        doc.setDocTitle(docTitle);
        doc.setSwaggerGroup(swaggerGroup);
        doc.setDocContent(docContent);
        doc.setSortOrder(sortOrder);
        return workspaceRepository.save(doc);
    }

    /**
     * 删除工作区文档。
     */
    @Transactional
    public void removeDoc(Long workflowId, Long docId) {
        workspaceRepository.deleteByWorkflowIdAndId(workflowId, docId);
    }

    /**
     * 聚合工作流的所有文档为上下文文本。
     * <p>
     * SWAGGER_GROUP 类型：从本地 Swagger 端点拉取 OpenAPI JSON 并精简。
     * CUSTOM 类型：直接拼接 docTitle + docContent。
     */
    public String assembleContextForAgent(Long workflowId) {
        List<AiWorkflowWorkspace> docs = workspaceRepository.findByWorkflowIdOrderBySortOrder(workflowId);
        if (docs.isEmpty()) {
            return "";
        }

        StringBuilder sb = new StringBuilder();
        for (AiWorkflowWorkspace doc : docs) {
            sb.append("--- ").append(doc.getDocTitle() != null ? doc.getDocTitle() : doc.getDocType()).append(" ---\n");

            if ("SWAGGER_GROUP".equals(doc.getDocType()) && doc.getSwaggerGroup() != null) {
                // 从本地 Swagger 端点拉取 OpenAPI JSON
                try {
                    String swaggerUrl = "http://localhost:" + serverPort + "/api-docs/" + doc.getSwaggerGroup();
                    String openApiJson = restTemplate.getForObject(swaggerUrl, String.class);
                    if (openApiJson != null) {
                        String simplified = simplifyOpenApiDoc(openApiJson);
                        sb.append(simplified);
                    }
                } catch (Exception e) {
                    log.warn("[AiWorkflowWorkspaceService] Failed to fetch Swagger doc for group '{}': {}",
                            doc.getSwaggerGroup(), e.getMessage());
                    sb.append("[无法获取 Swagger 文档: ").append(doc.getSwaggerGroup()).append("]\n");
                }
            } else {
                // CUSTOM 类型或其他：直接拼接内容
                if (doc.getDocContent() != null) {
                    sb.append(doc.getDocContent());
                }
            }

            sb.append("\n\n");
        }

        return sb.toString();
    }

    /**
     * 精简 OpenAPI JSON：只保留 paths 和 components.schemas，去掉其他部分。
     */
    public String simplifyOpenApiDoc(String openApiJson) {
        try {
            JsonNode root = objectMapper.readTree(openApiJson);
            ObjectNode simplified = objectMapper.createObjectNode();

            // 保留 paths
            if (root.has("paths")) {
                simplified.set("paths", root.get("paths"));
            }

            // 保留 components.schemas
            if (root.has("components") && root.get("components").has("schemas")) {
                ObjectNode components = objectMapper.createObjectNode();
                components.set("schemas", root.get("components").get("schemas"));
                simplified.set("components", components);
            }

            return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(simplified);
        } catch (Exception e) {
            log.warn("[AiWorkflowWorkspaceService] Failed to simplify OpenAPI doc: {}", e.getMessage());
            // 解析失败时返回原始内容
            return openApiJson;
        }
    }

    /**
     * 获取可用的 Swagger Group 列表。
     */
    public List<String> getSwaggerGroups() {
        return List.of("1-auth", "2-ticket", "3-task", "4-system");
    }

    /**
     * 预览指定 Swagger Group 的精简文档内容。
     */
    public String previewSwaggerGroup(String group) {
        try {
            String swaggerUrl = "http://localhost:" + serverPort + "/api-docs/" + group;
            String openApiJson = restTemplate.getForObject(swaggerUrl, String.class);
            if (openApiJson != null) {
                return simplifyOpenApiDoc(openApiJson);
            }
            return "[无法获取 Swagger 文档: " + group + "]";
        } catch (Exception e) {
            log.warn("[AiWorkflowWorkspaceService] Failed to fetch Swagger doc for group '{}': {}",
                    group, e.getMessage());
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "获取 Swagger 文档失败: " + e.getMessage());
        }
    }
}
