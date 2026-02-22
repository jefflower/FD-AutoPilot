package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Service
public class AgentDefinitionService {

    private final AgentDefinitionRepository repository;

    public AgentDefinitionService(AgentDefinitionRepository repository) {
        this.repository = repository;
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
        existing.setProviderConfig(updated.getProviderConfig());
        existing.setSortOrder(updated.getSortOrder());

        // code 和 builtIn 不允许修改
        return repository.save(existing);
    }

    @Transactional
    public void toggleEnabled(Long id) {
        AgentDefinition def = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.AGENT_NOT_FOUND));
        def.setEnabled(!def.isEnabled());
        repository.save(def);
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
