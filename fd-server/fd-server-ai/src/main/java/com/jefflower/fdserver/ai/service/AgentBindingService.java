package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Agent 能力绑定服务
 *
 * 管理 capability → agentCode 的映射关系。
 * 存储在 SystemConfig 中，key 格式: "agent.binding.{capability}"
 *
 * 由于 SystemConfig 在 ticket 模块中，此处使用简单的 JPA 查询替代，
 * 通过 AgentDefinition 表的 capability 字段 + 优先级来实现。
 * 使用独立的 agent_binding 表存储。
 */
@Service
public class AgentBindingService {

    private static final String BINDING_PREFIX = "agent.binding.";

    private final AgentDefinitionRepository definitionRepository;
    private final AgentBindingRepository bindingRepository;

    public AgentBindingService(AgentDefinitionRepository definitionRepository,
                                AgentBindingRepository bindingRepository) {
        this.definitionRepository = definitionRepository;
        this.bindingRepository = bindingRepository;
    }

    public Map<String, String> getAllBindings() {
        Map<String, String> result = new LinkedHashMap<>();
        bindingRepository.findAll().forEach(b -> result.put(b.getCapability(), b.getAgentCode()));
        return result;
    }

    public String getBinding(String capability) {
        return bindingRepository.findByCapability(capability)
                .map(AgentBinding::getAgentCode)
                .orElse(null);
    }

    @Transactional
    public void setBinding(String capability, String agentCode) {
        // 验证 agentCode 存在
        definitionRepository.findByCode(agentCode)
                .orElseThrow(() -> new BusinessException(ErrorCode.AGENT_NOT_FOUND,
                        "Agent 不存在: " + agentCode));

        AgentBinding binding = bindingRepository.findByCapability(capability)
                .orElseGet(() -> {
                    AgentBinding b = new AgentBinding();
                    b.setCapability(capability);
                    return b;
                });
        binding.setAgentCode(agentCode);
        bindingRepository.save(binding);
    }

    @Transactional
    public void removeBinding(String capability) {
        bindingRepository.findByCapability(capability)
                .ifPresent(bindingRepository::delete);
    }

    /**
     * 获取某个能力的默认 Agent code
     * 优先使用绑定配置，否则返回该 capability 下第一个启用的 Agent
     */
    public String resolveAgentCode(String capability) {
        String boundCode = getBinding(capability);
        if (boundCode != null) {
            return boundCode;
        }

        List<AgentDefinition> agents = definitionRepository
                .findByCapabilityAndEnabledTrueOrderBySortOrder(capability);
        return agents.isEmpty() ? null : agents.get(0).getCode();
    }
}
