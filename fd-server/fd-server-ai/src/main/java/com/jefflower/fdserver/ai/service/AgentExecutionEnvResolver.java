package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentInstance;
import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.repository.AgentInstanceRepository;
import com.jefflower.fdserver.ai.repository.CapabilityDefinitionRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Agent 执行环境解析器。
 * <p>
 * 负责：
 * 1. 解析 Agent 的有效 executionEnv（优先从 Capability 获取，回退到 Agent 自身字段）
 * 2. 校验 Agent 是否可在客户端执行（enabled 检查、executionEnv 检查、capability 启用检查）
 * 3. 查找在线的 AgentInstance 以支持配置合并
 */
@Slf4j
@Service
public class AgentExecutionEnvResolver {

    private final AgentDefinitionService agentDefinitionService;
    private final CapabilityDefinitionRepository capabilityDefinitionRepository;
    private final AgentInstanceRepository agentInstanceRepository;

    public AgentExecutionEnvResolver(AgentDefinitionService agentDefinitionService,
                                      CapabilityDefinitionRepository capabilityDefinitionRepository,
                                      AgentInstanceRepository agentInstanceRepository) {
        this.agentDefinitionService = agentDefinitionService;
        this.capabilityDefinitionRepository = capabilityDefinitionRepository;
        this.agentInstanceRepository = agentInstanceRepository;
    }

    /**
     * 解析 Agent 的有效 executionEnv。
     * 优先从 requiredCapability → CapabilityDefinition.executionEnv 获取，
     * 回退到 Agent 自身字段（兼容旧数据），默认 CLIENT_ONLY。
     *
     * @param agentDef Agent 定义
     * @return 有效的 ExecutionEnv
     */
    public ExecutionEnv resolveExecutionEnv(AgentDefinition agentDef) {
        if (agentDef.getRequiredCapability() != null) {
            Optional<CapabilityDefinition> capOpt = capabilityDefinitionRepository
                    .findByCode(agentDef.getRequiredCapability());
            if (capOpt.isPresent() && capOpt.get().getExecutionEnv() != null) {
                return capOpt.get().getExecutionEnv();
            }
        }
        return agentDef.getExecutionEnv() != null ? agentDef.getExecutionEnv() : ExecutionEnv.CLIENT_ONLY;
    }

    /**
     * 从已查询的 CapabilityDefinition 解析 executionEnv，避免重复 DB 查询。
     *
     * @param agentDef Agent 定义
     * @param capabilityDef 已查询的 CapabilityDefinition（可为 null）
     * @return 有效的 ExecutionEnv
     */
    ExecutionEnv resolveExecutionEnv(AgentDefinition agentDef, CapabilityDefinition capabilityDef) {
        if (capabilityDef != null && capabilityDef.getExecutionEnv() != null) {
            return capabilityDef.getExecutionEnv();
        }
        return agentDef.getExecutionEnv() != null ? agentDef.getExecutionEnv() : ExecutionEnv.CLIENT_ONLY;
    }

    /**
     * 校验 Agent 存在且可在客户端执行，并检查 Capability 是否启用。
     *
     * @param agentCode Agent 编码
     * @return 校验通过的 AgentDefinition
     * @throws BusinessException 如果 Agent 不存在、已禁用、不支持客户端执行或 Capability 未启用
     */
    public AgentDefinition validateForClientExecution(String agentCode) {
        AgentDefinition agentDef = agentDefinitionService.findByCode(agentCode)
                .orElseThrow(() -> new BusinessException(ErrorCode.AGENT_NOT_FOUND,
                        "Agent not found: " + agentCode));

        if (!agentDef.isEnabled()) {
            throw new BusinessException(ErrorCode.AGENT_NOT_AVAILABLE,
                    "Agent is disabled: " + agentCode);
        }

        // 查询一次 CapabilityDefinition，复用于 executionEnv 解析和启用检查
        CapabilityDefinition capabilityDef = null;
        if (agentDef.getRequiredCapability() != null) {
            Optional<CapabilityDefinition> capOpt = capabilityDefinitionRepository
                    .findByCode(agentDef.getRequiredCapability());
            if (capOpt.isEmpty() || !capOpt.get().isEnabled()) {
                throw new BusinessException(ErrorCode.CAPABILITY_DISABLED,
                        "Capability '" + agentDef.getRequiredCapability() + "' is disabled or not found");
            }
            capabilityDef = capOpt.get();
        }

        // executionEnv 解析复用已查询的 CapabilityDefinition
        ExecutionEnv effectiveEnv = resolveExecutionEnv(agentDef, capabilityDef);
        if (effectiveEnv == ExecutionEnv.SERVER_ONLY) {
            throw new BusinessException(ErrorCode.AGENT_NOT_AVAILABLE,
                    "Agent " + agentCode + " is SERVER_ONLY, cannot execute on client");
        }

        return agentDef;
    }

    /**
     * 查找指定 Agent 的第一个在线实例。
     *
     * @param agentCode Agent 编码
     * @return 在线 AgentInstance，如果没有在线实例则返回 null
     */
    public AgentInstance findOnlineInstance(String agentCode) {
        LocalDateTime cutoff = LocalDateTime.now().minusSeconds(60);
        List<AgentInstance> onlineInstances = agentInstanceRepository
                .findOnlineInstancesByAgentCode(agentCode, cutoff);
        return onlineInstances.isEmpty() ? null : onlineInstances.get(0);
    }
}
