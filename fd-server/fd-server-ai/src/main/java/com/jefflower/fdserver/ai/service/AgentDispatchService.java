package com.jefflower.fdserver.ai.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ai.dto.AgentExecuteResult;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentExecution;
import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.ai.repository.CapabilityDefinitionRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class AgentDispatchService {

    private static final Logger log = LoggerFactory.getLogger(AgentDispatchService.class);

    private final AgentDefinitionService definitionService;
    private final AgentExecutionService executionService;
    private final CapabilityDefinitionRepository capabilityDefinitionRepository;
    private final Map<ProviderType, AgentProvider> providerMap;
    private final ObjectMapper objectMapper;

    public AgentDispatchService(AgentDefinitionService definitionService,
                                AgentExecutionService executionService,
                                CapabilityDefinitionRepository capabilityDefinitionRepository,
                                List<AgentProvider> providers,
                                ObjectMapper objectMapper) {
        this.definitionService = definitionService;
        this.executionService = executionService;
        this.capabilityDefinitionRepository = capabilityDefinitionRepository;
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

        // executionEnv 从 CapabilityDefinition 获取（Agent 层字段已废弃）
        ExecutionEnv effectiveEnv = resolveExecutionEnv(def);
        if (effectiveEnv == ExecutionEnv.CLIENT_ONLY) {
            throw new BusinessException(ErrorCode.AGENT_NOT_AVAILABLE, "Agent 仅支持客户端执行: " + agentCode);
        }

        // Capability 启用检查
        checkCapabilityEnabled(def);

        // providerType 从 CapabilityDefinition 获取（Agent 层字段已废弃）
        ProviderType effectiveProvider = resolveProviderType(def);
        AgentProvider provider = providerMap.get(effectiveProvider);
        if (provider == null) {
            throw new BusinessException(ErrorCode.AGENT_PROVIDER_NOT_FOUND,
                    "未找到 ProviderType 为 " + effectiveProvider + " 的 Provider");
        }

        // 解析 agentConfig
        Map<String, Object> config = parseConfig(def.getAgentConfig());

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
     * 在服务端执行 Agent（结构化输入版本）
     * 将 structuredInput 序列化为 JSON 字符串后调用原有方法
     */
    public AgentExecuteResult executeOnServer(String agentCode, Map<String, Object> structuredInput,
                                               String refType, Long refId, String userId) {
        try {
            String jsonInput = objectMapper.writeValueAsString(structuredInput);
            return executeOnServer(agentCode, jsonInput, refType, refId, userId);
        } catch (Exception e) {
            log.error("[AgentDispatchService] Failed to serialize structured input for agent: {}", agentCode, e);
            return new AgentExecuteResult(false, null, null, "序列化输入失败: " + e.getMessage());
        }
    }

    /**
     * 获取客户端可执行的 Agent 定义列表
     */
    public List<AgentDefinition> getClientExecutableAgents() {
        return definitionService.findEnabled().stream()
                .filter(d -> resolveExecutionEnv(d) != ExecutionEnv.SERVER_ONLY)
                .filter(this::isCapabilityEnabled)
                .toList();
    }

    /**
     * 检查 Agent 的 requiredCapability 对应的 Capability 是否启用。
     * 如果 requiredCapability 为 null，跳过检查（兼容旧数据）。
     */
    private void checkCapabilityEnabled(AgentDefinition def) {
        if (def.getRequiredCapability() == null) {
            return;
        }
        Optional<CapabilityDefinition> capOpt = capabilityDefinitionRepository
                .findByCode(def.getRequiredCapability());
        if (capOpt.isEmpty() || !capOpt.get().isEnabled()) {
            throw new BusinessException(ErrorCode.CAPABILITY_DISABLED,
                    "Capability '" + def.getRequiredCapability() + "' is disabled or not found");
        }
    }

    /**
     * 判断 Agent 的 requiredCapability 对应的 Capability 是否启用（用于过滤）。
     * 如果 requiredCapability 为 null，视为启用（兼容旧数据）。
     */
    private boolean isCapabilityEnabled(AgentDefinition def) {
        if (def.getRequiredCapability() == null) {
            return true;
        }
        return capabilityDefinitionRepository.findByCode(def.getRequiredCapability())
                .map(CapabilityDefinition::isEnabled)
                .orElse(false);
    }

    /**
     * 解析 Agent 的有效 executionEnv。
     * 优先从 requiredCapability → CapabilityDefinition.executionEnv 获取，
     * 回退到 Agent 自身字段（兼容旧数据），默认 CLIENT_ONLY。
     */
    private ExecutionEnv resolveExecutionEnv(AgentDefinition def) {
        if (def.getRequiredCapability() != null) {
            Optional<CapabilityDefinition> capOpt = capabilityDefinitionRepository
                    .findByCode(def.getRequiredCapability());
            if (capOpt.isPresent() && capOpt.get().getExecutionEnv() != null) {
                return capOpt.get().getExecutionEnv();
            }
        }
        // 回退到 Agent 自身字段（兼容旧数据）
        return def.getExecutionEnv() != null ? def.getExecutionEnv() : ExecutionEnv.CLIENT_ONLY;
    }

    /**
     * 解析 Agent 的有效 providerType。
     * 优先从 requiredCapability → CapabilityDefinition.providerType 获取，
     * 回退到 Agent 自身字段（兼容旧数据）。
     */
    private ProviderType resolveProviderType(AgentDefinition def) {
        if (def.getRequiredCapability() != null) {
            Optional<CapabilityDefinition> capOpt = capabilityDefinitionRepository
                    .findByCode(def.getRequiredCapability());
            if (capOpt.isPresent() && capOpt.get().getProviderType() != null) {
                return capOpt.get().getProviderType();
            }
        }
        return def.getProviderType();
    }

    private Map<String, Object> parseConfig(String configJson) {
        if (configJson == null || configJson.isBlank()) {
            return new HashMap<>();
        }
        try {
            return objectMapper.readValue(configJson, new TypeReference<>() {});
        } catch (Exception e) {
            log.warn("[AgentDispatchService] Failed to parse agentConfig: {}", e.getMessage());
            return new HashMap<>();
        }
    }
}
