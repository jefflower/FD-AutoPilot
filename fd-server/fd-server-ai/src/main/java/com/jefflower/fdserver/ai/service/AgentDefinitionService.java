package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.CapabilityDefinitionRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class AgentDefinitionService {

    private final AgentDefinitionRepository repository;
    private final CapabilityDefinitionRepository capabilityDefinitionRepository;

    public AgentDefinitionService(AgentDefinitionRepository repository,
                                   CapabilityDefinitionRepository capabilityDefinitionRepository) {
        this.repository = repository;
        this.capabilityDefinitionRepository = capabilityDefinitionRepository;
    }

    public List<AgentDefinition> findAll() {
        return repository.findAllByOrderBySortOrder();
    }

    public List<AgentDefinition> findEnabled() {
        return repository.findByEnabledTrueOrderBySortOrder();
    }

    public List<AgentDefinition> findByCapability(String capability) {
        return repository.findByCapabilityAndEnabledTrueOrderBySortOrder(capability);
    }

    public Optional<AgentDefinition> findByCode(String code) {
        return repository.findByCode(code);
    }

    public List<AgentDefinition> findByGroupCode(String groupCode) {
        return repository.findByGroupCodeAndEnabledTrueOrderBySortOrder(groupCode);
    }

    public List<String> getGroupCodes() {
        return repository.findAllByOrderBySortOrder().stream()
                .map(AgentDefinition::getGroupCode)
                .filter(gc -> gc != null && !gc.isBlank())
                .distinct()
                .collect(Collectors.toList());
    }

    @Transactional
    public AgentDefinition create(AgentDefinition def) {
        if (repository.existsByCode(def.getCode())) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "Agent code 已存在: " + def.getCode());
        }
        return repository.save(def);
    }

    @Transactional
    public AgentDefinition update(Long id, AgentDefinition updated) {
        AgentDefinition existing = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.AGENT_NOT_FOUND));

        existing.setName(updated.getName());
        existing.setDescription(updated.getDescription());
        existing.setProviderType(updated.getProviderType());
        existing.setExecutionEnv(updated.getExecutionEnv());
        existing.setCapability(updated.getCapability());
        existing.setGroupCode(updated.getGroupCode());
        existing.setCallMode(updated.getCallMode());
        existing.setCallUrl(updated.getCallUrl());
        existing.setAgentConfig(updated.getAgentConfig());
        existing.setInputSchema(updated.getInputSchema());
        existing.setOutputSchema(updated.getOutputSchema());
        existing.setTemplateEngine(updated.getTemplateEngine());
        existing.setSortOrder(updated.getSortOrder());
        existing.setAutoStart(updated.isAutoStart());
        existing.setRequiredCapability(updated.getRequiredCapability());
        existing.setSystemPrompt(updated.getSystemPrompt());

        // 如果更新后 Agent 是启用状态，校验 requiredCapability 对应的 Capability 是否存在且启用
        if (existing.isEnabled()) {
            checkRequiredCapabilityEnabled(existing);
        }

        // code 和 builtIn 不允许修改
        return repository.save(existing);
    }

    @Transactional
    public void toggleEnabled(Long id) {
        AgentDefinition def = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.AGENT_NOT_FOUND));

        boolean newEnabled = !def.isEnabled();

        // 如果要启用 Agent，检查其 requiredCapability 对应的 Capability 是否存在且启用
        if (newEnabled) {
            checkRequiredCapabilityEnabled(def);
        }

        def.setEnabled(newEnabled);
        repository.save(def);
    }

    /**
     * 校验 Agent 的 requiredCapability 对应的 Capability 是否存在且启用。
     * 如果 requiredCapability 为 null，跳过检查（兼容旧数据）。
     */
    private void checkRequiredCapabilityEnabled(AgentDefinition def) {
        if (def.getRequiredCapability() == null) {
            return;
        }
        Optional<CapabilityDefinition> capOpt = capabilityDefinitionRepository
                .findByCode(def.getRequiredCapability());
        if (capOpt.isEmpty() || !capOpt.get().isEnabled()) {
            throw new BusinessException(ErrorCode.CAPABILITY_DISABLED,
                    "无法启用 Agent '" + def.getCode() + "'：所需的 Capability '" + def.getRequiredCapability() + "' 未启用");
        }
    }

    @Transactional
    public void delete(Long id) {
        AgentDefinition def = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.AGENT_NOT_FOUND));
        if (def.isBuiltIn()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "内置 Agent 不可删除");
        }
        repository.delete(def);
    }
}
