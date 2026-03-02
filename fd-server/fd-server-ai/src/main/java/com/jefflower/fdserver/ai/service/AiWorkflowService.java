package com.jefflower.fdserver.ai.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ai.entity.AiWorkflow;
import com.jefflower.fdserver.ai.entity.AiWorkflowVersion;
import com.jefflower.fdserver.ai.repository.AiWorkflowRepository;
import com.jefflower.fdserver.ai.repository.AiWorkflowVersionRepository;
import com.jefflower.fdserver.ai.repository.AiWorkflowWorkspaceRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Slf4j
@Service
public class AiWorkflowService {

    private final AiWorkflowRepository workflowRepository;
    private final AiWorkflowVersionRepository versionRepository;
    private final AiWorkflowWorkspaceRepository workspaceRepository;
    private final N8nApiService n8nApiService;
    private final ObjectMapper objectMapper;

    public AiWorkflowService(AiWorkflowRepository workflowRepository,
                              AiWorkflowVersionRepository versionRepository,
                              AiWorkflowWorkspaceRepository workspaceRepository,
                              N8nApiService n8nApiService,
                              ObjectMapper objectMapper) {
        this.workflowRepository = workflowRepository;
        this.versionRepository = versionRepository;
        this.workspaceRepository = workspaceRepository;
        this.n8nApiService = n8nApiService;
        this.objectMapper = objectMapper;
    }

    /**
     * 创建一个 DRAFT 状态的工作流。
     */
    @Transactional
    public AiWorkflow create(String name, String description, String createdBy) {
        AiWorkflow workflow = new AiWorkflow();
        workflow.setName(name);
        workflow.setDescription(description);
        workflow.setCreatedBy(createdBy);
        workflow.setStatus("DRAFT");
        workflow.setCurrentVersion(0);
        return workflowRepository.save(workflow);
    }

    /**
     * 更新工作流 JSON，自动创建版本快照。
     */
    @Transactional
    public AiWorkflow updateJson(Long id, String json, String changeDescription, String username) {
        AiWorkflow workflow = getById(id);

        // 创建版本快照
        int newVersion = workflow.getCurrentVersion() + 1;
        AiWorkflowVersion version = new AiWorkflowVersion();
        version.setWorkflowId(id);
        version.setVersionNumber(newVersion);
        version.setWorkflowJson(json);
        version.setChangeDescription(changeDescription);
        version.setCreatedBy(username);
        versionRepository.save(version);

        // 更新当前工作流
        workflow.setCurrentJson(json);
        workflow.setCurrentVersion(newVersion);
        return workflowRepository.save(workflow);
    }

    /**
     * 根据 ID 获取工作流，不存在则抛异常。
     */
    public AiWorkflow getById(Long id) {
        return workflowRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.WORKFLOW_NOT_FOUND));
    }

    /**
     * 获取所有工作流，按创建时间倒序。
     */
    public List<AiWorkflow> list() {
        return workflowRepository.findAllByOrderByCreatedAtDesc();
    }

    /**
     * 从 n8n 同步工作流列表。
     * <p>
     * 对于 n8n 中存在但本地不存在的工作流，自动创建本地元数据记录。
     * 对于已有的本地记录，更新名称和状态（不覆盖 currentJson，保留本地版本管理）。
     *
     * @return 同步后的工作流列表
     */
    @Transactional
    public List<AiWorkflow> syncFromN8n() {
        try {
            String n8nResponse = n8nApiService.listWorkflows();
            JsonNode root = objectMapper.readTree(n8nResponse);

            // n8n REST API v1 返回格式: { "data": [...] }
            JsonNode dataNode = root.has("data") ? root.get("data") : root;
            if (!dataNode.isArray()) {
                log.warn("[AiWorkflowService] n8n workflows response is not an array, returning local list");
                return list();
            }

            // 收集已同步的 n8nWorkflowId
            Set<String> syncedN8nIds = new HashSet<>();

            for (JsonNode wfNode : dataNode) {
                String n8nId = wfNode.has("id") ? wfNode.get("id").asText() : null;
                if (n8nId == null) continue;

                String name = wfNode.has("name") ? wfNode.get("name").asText("") : "";
                boolean active = wfNode.has("active") && wfNode.get("active").asBoolean(false);

                // 查找本地是否已有对应记录
                Optional<AiWorkflow> existingOpt = workflowRepository.findByN8nWorkflowId(n8nId);

                if (existingOpt.isPresent()) {
                    // 已存在：更新名称和状态
                    AiWorkflow existing = existingOpt.get();
                    existing.setName(name);
                    existing.setStatus(active ? "ACTIVE" : "INACTIVE");
                    workflowRepository.save(existing);
                } else {
                    // 新工作流：创建本地元数据记录，只存最新 JSON
                    AiWorkflow newWf = new AiWorkflow();
                    newWf.setN8nWorkflowId(n8nId);
                    newWf.setName(name);
                    newWf.setDescription("");
                    newWf.setCreatedBy("n8n-sync");
                    newWf.setStatus(active ? "ACTIVE" : "INACTIVE");
                    newWf.setCurrentVersion(0);

                    // 从 n8n 获取完整 JSON 并存为 currentJson
                    String fullJson = null;
                    try {
                        fullJson = n8nApiService.getWorkflow(n8nId);
                        newWf.setCurrentJson(fullJson);
                    } catch (Exception e) {
                        log.warn("[AiWorkflowService] Failed to fetch workflow {} JSON from n8n: {}",
                                n8nId, e.getMessage());
                    }

                    // 先保存工作流以获取 ID
                    AiWorkflow savedWf = workflowRepository.save(newWf);

                    // 如果有 JSON，创建初始版本记录
                    if (fullJson != null && !fullJson.isBlank()) {
                        savedWf.setCurrentVersion(1);
                        workflowRepository.save(savedWf);

                        AiWorkflowVersion initVersion = new AiWorkflowVersion();
                        initVersion.setWorkflowId(savedWf.getId());
                        initVersion.setVersionNumber(1);
                        initVersion.setWorkflowJson(fullJson);
                        initVersion.setChangeDescription("Initial sync from n8n");
                        initVersion.setCreatedBy("n8n-sync");
                        versionRepository.save(initVersion);
                    }

                    log.info("[AiWorkflowService] Synced new workflow from n8n: {} ({})", name, n8nId);
                }

                syncedN8nIds.add(n8nId);
            }

            log.info("[AiWorkflowService] Synced {} workflows from n8n", syncedN8nIds.size());

        } catch (Exception e) {
            log.warn("[AiWorkflowService] Failed to sync from n8n, returning local list: {}", e.getMessage());
        }

        return list();
    }

    /**
     * 获取工作流版本列表（降序）。
     * 如果工作流有 JSON 但无版本记录，自动补充初始版本。
     */
    @Transactional
    public List<AiWorkflowVersion> getVersions(Long workflowId) {
        AiWorkflow workflow = getById(workflowId);
        List<AiWorkflowVersion> versions = versionRepository.findByWorkflowIdOrderByVersionNumberDesc(workflowId);

        // 自动补充初始版本：有 JSON 但无版本记录
        if (versions.isEmpty() && workflow.getCurrentJson() != null && !workflow.getCurrentJson().isBlank()) {
            AiWorkflowVersion initVersion = new AiWorkflowVersion();
            initVersion.setWorkflowId(workflowId);
            initVersion.setVersionNumber(1);
            initVersion.setWorkflowJson(workflow.getCurrentJson());
            initVersion.setChangeDescription("Initial version (auto-created)");
            initVersion.setCreatedBy(workflow.getCreatedBy() != null ? workflow.getCreatedBy() : "system");
            versionRepository.save(initVersion);

            workflow.setCurrentVersion(1);
            workflowRepository.save(workflow);

            versions = versionRepository.findByWorkflowIdOrderByVersionNumberDesc(workflowId);
            log.info("[AiWorkflowService] Auto-created initial version for workflow {}", workflowId);
        }

        return versions;
    }

    /**
     * 回滚到指定版本：用版本快照 JSON 覆盖 currentJson，设置 currentVersion。
     */
    @Transactional
    public AiWorkflow rollbackToVersion(Long id, int versionNumber) {
        AiWorkflow workflow = getById(id);
        AiWorkflowVersion version = versionRepository.findByWorkflowIdAndVersionNumber(id, versionNumber)
                .orElseThrow(() -> new BusinessException(ErrorCode.WORKFLOW_VERSION_NOT_FOUND,
                        "版本 " + versionNumber + " 不存在"));

        workflow.setCurrentJson(version.getWorkflowJson());
        workflow.setCurrentVersion(versionNumber);
        return workflowRepository.save(workflow);
    }

    /**
     * 校验 JSON 格式：Jackson 解析，检查 nodes 和 connections 字段存在。
     */
    public void validateJson(String json) {
        if (json == null || json.isBlank()) {
            throw new BusinessException(ErrorCode.WORKFLOW_INVALID_JSON, "工作流 JSON 不能为空");
        }
        try {
            JsonNode root = objectMapper.readTree(json);
            if (!root.has("nodes")) {
                throw new BusinessException(ErrorCode.WORKFLOW_INVALID_JSON, "工作流 JSON 缺少 'nodes' 字段");
            }
            if (!root.has("connections")) {
                throw new BusinessException(ErrorCode.WORKFLOW_INVALID_JSON, "工作流 JSON 缺少 'connections' 字段");
            }
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(ErrorCode.WORKFLOW_INVALID_JSON, "工作流 JSON 解析失败: " + e.getMessage());
        }
    }

    /**
     * 直接保存工作流实体（用于更新 n8nWorkflowId、status 等字段）。
     */
    @Transactional
    public AiWorkflow save(AiWorkflow workflow) {
        return workflowRepository.save(workflow);
    }

    /**
     * 删除工作流，级联删除版本和工作区文档。
     */
    @Transactional
    public void delete(Long id) {
        AiWorkflow workflow = getById(id);

        // 级联删除版本
        List<AiWorkflowVersion> versions = versionRepository.findByWorkflowIdOrderByVersionNumberDesc(id);
        if (!versions.isEmpty()) {
            versionRepository.deleteAll(versions);
        }

        // 级联删除工作区文档
        var workspaceDocs = workspaceRepository.findByWorkflowIdOrderBySortOrder(id);
        if (!workspaceDocs.isEmpty()) {
            workspaceRepository.deleteAll(workspaceDocs);
        }

        workflowRepository.delete(workflow);
        log.info("[AiWorkflowService] Deleted workflow {} with {} versions and {} workspace docs",
                id, versions.size(), workspaceDocs.size());
    }
}
