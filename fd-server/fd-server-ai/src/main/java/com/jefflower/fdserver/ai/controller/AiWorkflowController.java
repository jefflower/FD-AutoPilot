package com.jefflower.fdserver.ai.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ai.dto.AgentChatRequest;
import com.jefflower.fdserver.ai.dto.AgentChatResponse;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AiWorkflow;
import com.jefflower.fdserver.ai.entity.AiWorkflowVersion;
import com.jefflower.fdserver.ai.entity.AiWorkflowWorkspace;
import com.jefflower.fdserver.ai.service.AgentChatService;
import com.jefflower.fdserver.ai.service.AgentDefinitionService;
import com.jefflower.fdserver.ai.service.AiWorkflowService;
import com.jefflower.fdserver.ai.service.AiWorkflowWorkspaceService;
import com.jefflower.fdserver.ai.service.N8nApiService;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Tag(name = "AI 工作流", description = "AI 工作流的 CRUD、版本管理、部署、对话")
@RestController
@RequestMapping("/api/v1/ai-workflows")
@RequiresPermission("ai:workflow")
public class AiWorkflowController {

    private final AiWorkflowService workflowService;
    private final AiWorkflowWorkspaceService workspaceService;
    private final N8nApiService n8nApiService;
    private final AgentChatService agentChatService;
    private final AgentDefinitionService agentDefinitionService;
    private final ObjectMapper objectMapper;

    public AiWorkflowController(AiWorkflowService workflowService,
                                 AiWorkflowWorkspaceService workspaceService,
                                 N8nApiService n8nApiService,
                                 AgentChatService agentChatService,
                                 AgentDefinitionService agentDefinitionService,
                                 ObjectMapper objectMapper) {
        this.workflowService = workflowService;
        this.workspaceService = workspaceService;
        this.n8nApiService = n8nApiService;
        this.agentChatService = agentChatService;
        this.agentDefinitionService = agentDefinitionService;
        this.objectMapper = objectMapper;
    }

    // ==================== 工作流 CRUD ====================

    @Operation(summary = "创建工作流")
    @PostMapping
    public ApiResponse<AiWorkflow> create(@RequestBody Map<String, String> body, Authentication auth) {
        String name = body.getOrDefault("name", "未命名工作流");
        String description = body.getOrDefault("description", "");
        String createdBy = auth != null ? auth.getName() : "anonymous";
        AiWorkflow workflow = workflowService.create(name, description, createdBy);
        return ApiResponse.ok("工作流创建成功", workflow);
    }

    @Operation(summary = "获取工作流列表（自动同步 n8n）")
    @GetMapping
    public ApiResponse<List<AiWorkflow>> list() {
        // 每次拉取列表时自动从 n8n 同步，确保显示最新的工作流
        return ApiResponse.ok(workflowService.syncFromN8n());
    }

    @Operation(summary = "获取工作流详情")
    @GetMapping("/{id}")
    public ApiResponse<AiWorkflow> getById(@PathVariable Long id) {
        return ApiResponse.ok(workflowService.getById(id));
    }

    @Operation(summary = "更新工作流 JSON")
    @PutMapping("/{id}/json")
    public ApiResponse<AiWorkflow> updateJson(@PathVariable Long id,
                                               @RequestBody Map<String, String> body,
                                               Authentication auth) {
        String json = body.get("json");
        String changeDescription = body.getOrDefault("changeDescription", "");
        String username = auth != null ? auth.getName() : "anonymous";
        AiWorkflow workflow = workflowService.updateJson(id, json, changeDescription, username);
        return ApiResponse.ok("工作流 JSON 已更新", workflow);
    }

    @Operation(summary = "删除工作流")
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        workflowService.delete(id);
        return ApiResponse.ok("工作流已删除", null);
    }

    @Operation(summary = "校验工作流 JSON")
    @PostMapping("/{id}/validate")
    public ApiResponse<Void> validate(@PathVariable Long id) {
        AiWorkflow workflow = workflowService.getById(id);
        workflowService.validateJson(workflow.getCurrentJson());
        return ApiResponse.ok("JSON 校验通过", null);
    }

    // ==================== 版本管理 ====================

    @Operation(summary = "获取版本列表")
    @GetMapping("/{id}/versions")
    public ApiResponse<List<AiWorkflowVersion>> getVersions(@PathVariable Long id) {
        return ApiResponse.ok(workflowService.getVersions(id));
    }

    @Operation(summary = "回滚到指定版本")
    @PostMapping("/{id}/rollback")
    public ApiResponse<AiWorkflow> rollback(@PathVariable Long id,
                                             @RequestBody Map<String, Integer> body) {
        int versionNumber = body.getOrDefault("versionNumber", 0);
        AiWorkflow workflow = workflowService.rollbackToVersion(id, versionNumber);
        return ApiResponse.ok("已回滚到版本 " + versionNumber, workflow);
    }

    // ==================== 部署 ====================

    @Operation(summary = "部署工作流到 n8n")
    @PostMapping("/{id}/deploy")
    public ApiResponse<AiWorkflow> deploy(@PathVariable Long id) {
        AiWorkflow workflow = workflowService.getById(id);
        workflowService.validateJson(workflow.getCurrentJson());

        if (workflow.getN8nWorkflowId() == null || workflow.getN8nWorkflowId().isBlank()) {
            // 首次部署：在 n8n 创建工作流
            String result = n8nApiService.createWorkflow(workflow.getCurrentJson());
            // 从 n8n 返回的 JSON 中解析 workflow id
            String n8nId = parseN8nWorkflowId(result);
            workflow.setN8nWorkflowId(n8nId);
        } else {
            // 更新已有工作流：先停用再更新
            try {
                n8nApiService.deactivateWorkflow(workflow.getN8nWorkflowId());
            } catch (Exception e) {
                log.warn("[AiWorkflowController] Failed to deactivate workflow before update: {}", e.getMessage());
            }
            n8nApiService.updateWorkflow(workflow.getN8nWorkflowId(), workflow.getCurrentJson());
        }

        workflow.setStatus("DEPLOYED");
        AiWorkflow saved = workflowService.save(workflow);
        return ApiResponse.ok("工作流已部署到 n8n", saved);
    }

    @Operation(summary = "激活 n8n 工作流")
    @PostMapping("/{id}/activate")
    public ApiResponse<Void> activate(@PathVariable Long id) {
        AiWorkflow workflow = workflowService.getById(id);
        if (workflow.getN8nWorkflowId() == null || workflow.getN8nWorkflowId().isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "工作流尚未部署到 n8n");
        }
        n8nApiService.activateWorkflow(workflow.getN8nWorkflowId());
        return ApiResponse.ok("n8n 工作流已激活", null);
    }

    @Operation(summary = "停用 n8n 工作流")
    @PostMapping("/{id}/deactivate")
    public ApiResponse<Void> deactivate(@PathVariable Long id) {
        AiWorkflow workflow = workflowService.getById(id);
        if (workflow.getN8nWorkflowId() == null || workflow.getN8nWorkflowId().isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "工作流尚未部署到 n8n");
        }
        n8nApiService.deactivateWorkflow(workflow.getN8nWorkflowId());
        return ApiResponse.ok("n8n 工作流已停用", null);
    }

    // ==================== AI 对话 ====================

    @Operation(summary = "与 AI 对话设计工作流")
    @PostMapping("/{id}/chat")
    public ApiResponse<AgentChatResponse> chat(@PathVariable Long id,
                                                @RequestBody AgentChatRequest request) {
        AiWorkflow workflow = workflowService.getById(id);

        // 聚合工作区文档
        String workspaceDocs = workspaceService.assembleContextForAgent(id);

        // 聚合工作流中相关 Agent 的提示词
        String relatedAgentPrompts = assembleRelatedAgentPrompts(workflow.getCurrentJson());

        // 构建 contextData
        Map<String, String> contextData = new HashMap<>();
        if (request.getContextData() != null) {
            contextData.putAll(request.getContextData());
        }
        contextData.put("WORKSPACE_DOCS", workspaceDocs);
        contextData.put("CURRENT_WORKFLOW_JSON",
                workflow.getCurrentJson() != null ? workflow.getCurrentJson() : "");
        contextData.put("RELATED_AGENT_PROMPTS", relatedAgentPrompts);

        // 调用通用 Agent 对话
        String agentCode = (request.getAgentCode() != null && !request.getAgentCode().isBlank())
                ? request.getAgentCode()
                : "n8n-workflow-designer";
        AgentChatResponse response = agentChatService.chat(
                agentCode,
                request.getUserMessage(),
                request.getConversationHistory(),
                contextData,
                request.getRefType() != null ? request.getRefType() : "ai-workflow",
                request.getRefId() != null ? request.getRefId() : id);

        return ApiResponse.ok(response);
    }

    // ==================== 工作区 ====================

    @Operation(summary = "获取工作区文档列表")
    @GetMapping("/{id}/workspace")
    public ApiResponse<List<AiWorkflowWorkspace>> getWorkspace(@PathVariable Long id) {
        // 确认工作流存在
        workflowService.getById(id);
        return ApiResponse.ok(workspaceService.getWorkspaceDocs(id));
    }

    @Operation(summary = "添加工作区文档")
    @PostMapping("/{id}/workspace")
    public ApiResponse<AiWorkflowWorkspace> addWorkspaceDoc(@PathVariable Long id,
                                                              @RequestBody Map<String, Object> body) {
        // 确认工作流存在
        workflowService.getById(id);

        String docType = (String) body.getOrDefault("docType", "CUSTOM");
        String docTitle = (String) body.getOrDefault("docTitle", "");
        String swaggerGroup = (String) body.get("swaggerGroup");
        String docContent = (String) body.get("docContent");
        int sortOrder = body.containsKey("sortOrder") ? ((Number) body.get("sortOrder")).intValue() : 0;

        AiWorkflowWorkspace doc = workspaceService.addDoc(id, docType, docTitle, swaggerGroup, docContent, sortOrder);
        return ApiResponse.ok("文档已添加", doc);
    }

    @Operation(summary = "删除工作区文档")
    @DeleteMapping("/{id}/workspace/{docId}")
    public ApiResponse<Void> removeWorkspaceDoc(@PathVariable Long id, @PathVariable Long docId) {
        workspaceService.removeDoc(id, docId);
        return ApiResponse.ok("文档已删除", null);
    }

    @Operation(summary = "获取可用的 Swagger Group 列表")
    @GetMapping("/swagger-groups")
    public ApiResponse<List<String>> getSwaggerGroups() {
        return ApiResponse.ok(workspaceService.getSwaggerGroups());
    }

    @Operation(summary = "预览 Swagger 文档内容（精简版）")
    @GetMapping("/swagger-preview/{group}")
    public ApiResponse<String> previewSwaggerDoc(@PathVariable String group) {
        return ApiResponse.ok(workspaceService.previewSwaggerGroup(group));
    }

    // ==================== 内部方法 ====================

    /**
     * 从当前工作流 JSON 中提取引用的 Agent code，加载其 systemPrompt 汇总。
     * <p>
     * 扫描 n8n 节点中 HTTP Request 节点的 URL 参数，匹配以下模式：
     * - /api/v1/agents/{code}/... → 提取 agentCode
     * - /api/v1/capabilities/{cap}/execute → 通过 capability 查找相关 Agent
     * <p>
     * 同时扫描节点 parameters 中出现的 agent_code / agentCode 字段。
     */
    private String assembleRelatedAgentPrompts(String workflowJson) {
        if (workflowJson == null || workflowJson.isBlank()) {
            return "(当前无工作流 JSON，无相关 Agent)";
        }

        Set<String> agentCodes = new HashSet<>();

        try {
            JsonNode root = objectMapper.readTree(workflowJson);
            JsonNode nodes = root.get("nodes");
            if (nodes == null || !nodes.isArray()) {
                return "(工作流中无节点)";
            }

            for (JsonNode node : nodes) {
                JsonNode params = node.get("parameters");
                if (params == null) continue;

                // 方式1：从 HTTP Request 节点的 URL 中提取
                String url = params.has("url") ? params.get("url").asText("") : "";
                extractAgentCodesFromUrl(url, agentCodes);

                // 方式2：从参数中提取直接引用的 agentCode
                if (params.has("agentCode")) {
                    agentCodes.add(params.get("agentCode").asText());
                }
                if (params.has("agent_code")) {
                    agentCodes.add(params.get("agent_code").asText());
                }

                // 方式3：递归扫描嵌套参数（如 n8n 表达式中引用的 body 参数）
                extractAgentCodesFromParams(params, agentCodes);
            }
        } catch (Exception e) {
            log.warn("[AiWorkflowController] Failed to parse workflow JSON for agent codes: {}", e.getMessage());
            return "(工作流 JSON 解析失败，无法提取相关 Agent)";
        }

        if (agentCodes.isEmpty()) {
            // 如果没有从 JSON 中提取到，则加载所有启用的 Agent 的摘要
            List<AgentDefinition> allAgents = agentDefinitionService.findEnabled();
            if (allAgents.isEmpty()) {
                return "(系统中无可用 Agent)";
            }
            StringBuilder sb = new StringBuilder();
            sb.append("### 系统中所有可用 Agent（供参考）\n\n");
            for (AgentDefinition agent : allAgents) {
                if ("n8n-workflow-designer".equals(agent.getCode())) continue;
                sb.append("- **").append(agent.getCode()).append("** (").append(agent.getName()).append(")\n");
                sb.append("  capability: ").append(agent.getCapability()).append("\n");
                if (agent.getDescription() != null) {
                    sb.append("  描述: ").append(agent.getDescription()).append("\n");
                }
                sb.append("\n");
            }
            return sb.toString();
        }

        // 加载匹配的 Agent 定义
        StringBuilder sb = new StringBuilder();
        sb.append("### 工作流中引用的 Agent 提示词\n\n");
        for (String code : agentCodes) {
            agentDefinitionService.findByCode(code).ifPresent(agent -> {
                sb.append("#### Agent: ").append(agent.getCode())
                        .append(" (").append(agent.getName()).append(")\n");
                sb.append("- capability: ").append(agent.getCapability()).append("\n");
                if (agent.getDescription() != null) {
                    sb.append("- 描述: ").append(agent.getDescription()).append("\n");
                }
                sb.append("- systemPrompt:\n```\n");
                sb.append(agent.getSystemPrompt() != null ? agent.getSystemPrompt() : "(无)");
                sb.append("\n```\n\n");
            });
        }

        return sb.length() > 40 ? sb.toString() : "(未找到匹配的 Agent 定义)";
    }

    /**
     * 从 URL 中提取 Agent code。
     * 匹配 /api/v1/agents/{code}/ 和 /api/v1/capabilities/{cap}/execute
     */
    private void extractAgentCodesFromUrl(String url, Set<String> agentCodes) {
        if (url == null || url.isBlank()) return;

        // /api/v1/agents/{code}/...
        java.util.regex.Matcher agentMatcher = java.util.regex.Pattern
                .compile("/api/v1/agents/([\\w-]+)")
                .matcher(url);
        while (agentMatcher.find()) {
            agentCodes.add(agentMatcher.group(1));
        }

        // /api/v1/capabilities/{cap}/execute → 通过 capability 查找 Agent
        java.util.regex.Matcher capMatcher = java.util.regex.Pattern
                .compile("/api/v1/capabilities/([\\w-]+)/execute")
                .matcher(url);
        while (capMatcher.find()) {
            String cap = capMatcher.group(1);
            List<AgentDefinition> agents = agentDefinitionService.findByCapability(cap);
            for (AgentDefinition agent : agents) {
                agentCodes.add(agent.getCode());
            }
        }
    }

    /**
     * 递归扫描参数 JSON 节点，提取出现的 agentCode 值。
     */
    private void extractAgentCodesFromParams(JsonNode node, Set<String> agentCodes) {
        if (node == null) return;
        if (node.isTextual()) {
            String text = node.asText();
            // 扫描文本中的 agent code 引用模式
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("/agents/([\\w-]+)")
                    .matcher(text);
            while (m.find()) {
                agentCodes.add(m.group(1));
            }
        } else if (node.isObject()) {
            node.fields().forEachRemaining(entry -> {
                String key = entry.getKey();
                JsonNode val = entry.getValue();
                // 直接 key 命名为 agentCode 或 agent_code
                if (("agentCode".equals(key) || "agent_code".equals(key)) && val.isTextual()) {
                    agentCodes.add(val.asText());
                } else {
                    extractAgentCodesFromParams(val, agentCodes);
                }
            });
        } else if (node.isArray()) {
            for (JsonNode child : node) {
                extractAgentCodesFromParams(child, agentCodes);
            }
        }
    }

    /**
     * 从 n8n 返回的 JSON 中解析 workflow id。
     */
    private String parseN8nWorkflowId(String n8nResponse) {
        try {
            JsonNode root = objectMapper.readTree(n8nResponse);
            if (root.has("id")) {
                return root.get("id").asText();
            }
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "n8n 响应中缺少 id 字段");
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR,
                    "解析 n8n 响应失败: " + e.getMessage());
        }
    }
}
