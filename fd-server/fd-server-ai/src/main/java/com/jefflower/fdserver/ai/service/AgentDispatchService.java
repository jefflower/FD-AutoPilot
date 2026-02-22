package com.jefflower.fdserver.ai.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ai.dto.AgentExecuteResult;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentExecution;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class AgentDispatchService {

    private static final Logger log = LoggerFactory.getLogger(AgentDispatchService.class);

    private final AgentDefinitionService definitionService;
    private final AgentExecutionService executionService;
    private final Map<ProviderType, AgentProvider> providerMap;
    private final ObjectMapper objectMapper;

    public AgentDispatchService(AgentDefinitionService definitionService,
                                AgentExecutionService executionService,
                                List<AgentProvider> providers,
                                ObjectMapper objectMapper) {
        this.definitionService = definitionService;
        this.executionService = executionService;
        this.objectMapper = objectMapper;
        this.providerMap = providers.stream()
                .collect(Collectors.toMap(AgentProvider::getProviderType, p -> p));
    }

    /**
     * 在服务端执行 Agent
     */
    public AgentExecuteResult executeOnServer(String agentCode, String input,
                                               String refType, Long refId, String userId) {
        AgentDefinition def = definitionService.findByCode(agentCode)
                .orElseThrow(() -> new BusinessException(ErrorCode.AGENT_NOT_FOUND));

        if (!def.isEnabled()) {
            throw new BusinessException(ErrorCode.AGENT_NOT_AVAILABLE, "Agent 已禁用: " + agentCode);
        }

        if (def.getExecutionEnv() == ExecutionEnv.CLIENT_ONLY) {
            throw new BusinessException(ErrorCode.AGENT_NOT_AVAILABLE, "Agent 仅支持客户端执行: " + agentCode);
        }

        AgentProvider provider = providerMap.get(def.getProviderType());
        if (provider == null) {
            throw new BusinessException(ErrorCode.AGENT_PROVIDER_NOT_FOUND,
                    "未找到 ProviderType 为 " + def.getProviderType() + " 的 Provider");
        }

        // 解析 providerConfig
        Map<String, Object> config = parseConfig(def.getProviderConfig());

        // 记录开始
        AgentExecution execution = executionService.startExecution(agentCode, refType, refId, userId, "server");
        long startTime = System.currentTimeMillis();

        try {
            AgentExecuteResult result = provider.execute(input, config);
            long duration = System.currentTimeMillis() - startTime;

            executionService.completeExecution(
                    execution.getId(),
                    result.isSuccess(),
                    duration,
                    result.getTokenCount(),
                    result.getOutput(),
                    result.getErrorMessage()
            );

            return result;
        } catch (Exception e) {
            long duration = System.currentTimeMillis() - startTime;
            log.error("[AgentDispatchService] Agent execution failed: {}", agentCode, e);

            executionService.completeExecution(
                    execution.getId(),
                    false,
                    duration,
                    null,
                    null,
                    e.getMessage()
            );

            return new AgentExecuteResult(false, null, null, e.getMessage());
        }
    }

    /**
     * 获取客户端可执行的 Agent 定义列表
     */
    public List<AgentDefinition> getClientExecutableAgents() {
        return definitionService.findEnabled().stream()
                .filter(d -> d.getExecutionEnv() != ExecutionEnv.SERVER_ONLY)
                .toList();
    }

    private Map<String, Object> parseConfig(String configJson) {
        if (configJson == null || configJson.isBlank()) {
            return new HashMap<>();
        }
        try {
            return objectMapper.readValue(configJson, new TypeReference<>() {});
        } catch (Exception e) {
            log.warn("[AgentDispatchService] Failed to parse providerConfig: {}", e.getMessage());
            return new HashMap<>();
        }
    }
}
