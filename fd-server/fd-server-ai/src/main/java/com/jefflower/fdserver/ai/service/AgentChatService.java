package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.dto.AgentChatRequest;
import com.jefflower.fdserver.ai.dto.AgentChatResponse;
import com.jefflower.fdserver.ai.dto.AgentExecuteResult;
import com.jefflower.fdserver.ai.dto.CapabilityRouteResult;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 通用 Agent 对话服务。
 * <p>
 * 将用户消息 + 上下文数据展开到 Agent 的 systemPrompt 模板中，
 * 通过 Capability 路由 + SyncBridge 发送到客户端执行。
 */
@Slf4j
@Service
public class AgentChatService {

    private final AgentDefinitionService definitionService;
    private final CapabilityRouterService capabilityRouterService;
    private final SyncAgentExecutionService syncAgentExecutionService;

    /** 默认超时 5 分钟 */
    private static final long DEFAULT_TIMEOUT_MS = 300_000L;

    public AgentChatService(AgentDefinitionService definitionService,
                             CapabilityRouterService capabilityRouterService,
                             SyncAgentExecutionService syncAgentExecutionService) {
        this.definitionService = definitionService;
        this.capabilityRouterService = capabilityRouterService;
        this.syncAgentExecutionService = syncAgentExecutionService;
    }

    /**
     * 通用 Agent 对话接口。
     *
     * @param agentCode          Agent 定义的 code
     * @param userMessage        用户消息
     * @param conversationHistory 对话历史
     * @param contextData        上下文数据（模板变量）
     * @param refType            关联业务类型
     * @param refId              关联业务 ID
     * @return 对话响应
     */
    public AgentChatResponse chat(String agentCode, String userMessage,
                                   List<AgentChatRequest.ChatMessage> conversationHistory,
                                   Map<String, String> contextData,
                                   String refType, Long refId) {
        // 1. 查找 Agent 定义
        AgentDefinition agentDef = definitionService.findByCode(agentCode)
                .orElseThrow(() -> new BusinessException(ErrorCode.AGENT_NOT_FOUND,
                        "Agent 不存在: " + agentCode));

        if (!agentDef.isEnabled()) {
            throw new BusinessException(ErrorCode.AGENT_NOT_AVAILABLE, "Agent 已禁用: " + agentCode);
        }

        // 2. 准备模板变量
        Map<String, String> templateVars = new HashMap<>();
        if (contextData != null) {
            templateVars.putAll(contextData);
        }
        templateVars.put("USER_MESSAGE", userMessage != null ? userMessage : "");
        templateVars.put("CONVERSATION_HISTORY", formatConversationHistory(conversationHistory));

        // 3. 展开 systemPrompt 模板
        String resolvedPrompt = resolveTemplate(agentDef.getSystemPrompt(), templateVars);

        // 4. 构建 Agent 执行输入
        Map<String, Object> input = new HashMap<>();
        input.put("prompt", resolvedPrompt);
        input.put("userMessage", userMessage);
        if (conversationHistory != null && !conversationHistory.isEmpty()) {
            input.put("conversationHistory", conversationHistory);
        }

        // 5. 通过 Capability 路由执行
        try {
            String capability = agentDef.getCapability();
            CapabilityRouteResult route = capabilityRouterService.route(capability, null, null);

            AgentExecuteResult result = syncAgentExecutionService.executeSyncViaRoute(
                    route, input,
                    refType != null ? refType : "ai-workflow",
                    refId != null ? String.valueOf(refId) : null,
                    DEFAULT_TIMEOUT_MS);

            if (result.isSuccess()) {
                return new AgentChatResponse(result.getOutput(), true, null);
            } else {
                return new AgentChatResponse(null, false, result.getErrorMessage());
            }
        } catch (BusinessException e) {
            log.warn("[AgentChatService] Chat failed for agent '{}': {}", agentCode, e.getMessage());
            return new AgentChatResponse(null, false, e.getMessage());
        } catch (Exception e) {
            log.error("[AgentChatService] Unexpected error for agent '{}': {}", agentCode, e.getMessage(), e);
            return new AgentChatResponse(null, false, "Agent 执行异常: " + e.getMessage());
        }
    }

    /**
     * 简单模板展开：将 ${VAR_NAME} 替换为 templateVars 中的值。
     */
    private String resolveTemplate(String template, Map<String, String> templateVars) {
        if (template == null || template.isBlank()) {
            return "";
        }
        String resolved = template;
        for (Map.Entry<String, String> entry : templateVars.entrySet()) {
            String placeholder = "${" + entry.getKey() + "}";
            resolved = resolved.replace(placeholder, entry.getValue() != null ? entry.getValue() : "");
        }
        return resolved;
    }

    /**
     * 将对话历史格式化为文本。
     */
    private String formatConversationHistory(List<AgentChatRequest.ChatMessage> history) {
        if (history == null || history.isEmpty()) {
            return "(无历史对话)";
        }
        return history.stream()
                .map(msg -> "[" + msg.getRole() + "]: " + msg.getContent())
                .collect(Collectors.joining("\n"));
    }
}
