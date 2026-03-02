package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.CapabilityDefinitionRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class CapabilityDefinitionService {

    private static final Logger log = LoggerFactory.getLogger(CapabilityDefinitionService.class);

    private final CapabilityDefinitionRepository repository;
    private final AgentDefinitionRepository agentDefinitionRepository;

    public CapabilityDefinitionService(CapabilityDefinitionRepository repository,
                                        AgentDefinitionRepository agentDefinitionRepository) {
        this.repository = repository;
        this.agentDefinitionRepository = agentDefinitionRepository;
    }

    /**
     * 返回所有已启用的 Capability（按 sortOrder）
     */
    public List<CapabilityDefinition> getEnabledCapabilities() {
        return repository.findByEnabledTrueOrderBySortOrder();
    }

    /**
     * 返回全部 Capability（按 sortOrder）
     */
    public List<CapabilityDefinition> getAllCapabilities() {
        return repository.findAllByOrderBySortOrder();
    }

    /**
     * 按 code 查询，不存在抛 CAPABILITY_NOT_FOUND
     */
    public CapabilityDefinition getByCode(String code) {
        return repository.findByCode(code)
                .orElseThrow(() -> new BusinessException(ErrorCode.CAPABILITY_NOT_FOUND,
                        "Capability not found: " + code));
    }

    /**
     * 创建 Capability，code 唯一校验
     */
    @Transactional
    public CapabilityDefinition create(CapabilityDefinition cap) {
        if (repository.existsByCode(cap.getCode())) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER,
                    "Capability code 已存在: " + cap.getCode());
        }
        return repository.save(cap);
    }

    /**
     * 更新 Capability
     */
    @Transactional
    public CapabilityDefinition update(Long id, CapabilityDefinition cap) {
        CapabilityDefinition existing = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.CAPABILITY_NOT_FOUND));

        existing.setName(cap.getName());
        existing.setDescription(cap.getDescription());
        existing.setProviderType(cap.getProviderType());
        existing.setDetectConfig(cap.getDetectConfig());
        existing.setInstallGuide(cap.getInstallGuide());
        existing.setExecutionEnv(cap.getExecutionEnv());
        existing.setSortOrder(cap.getSortOrder());
        // code 和 builtIn 不允许修改

        return repository.save(existing);
    }

    /**
     * 删除 Capability（仅非 builtIn）
     */
    @Transactional
    public void delete(Long id) {
        CapabilityDefinition cap = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.CAPABILITY_NOT_FOUND));
        if (cap.isBuiltIn()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "内置 Capability 不可删除");
        }
        repository.delete(cap);
    }

    /**
     * 开关切换 + Agent 联动逻辑：
     * - 禁用时：级联禁用所有 requiredCapability = 该 code 的 AgentDefinition
     * - 启用时：不自动启用 Agent
     */
    @Transactional
    public void toggleEnabled(Long id) {
        CapabilityDefinition cap = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.CAPABILITY_NOT_FOUND));

        boolean newEnabled = !cap.isEnabled();
        cap.setEnabled(newEnabled);
        repository.save(cap);

        if (!newEnabled) {
            // 禁用时：级联禁用所有关联 Agent
            List<AgentDefinition> relatedAgents = agentDefinitionRepository
                    .findByRequiredCapability(cap.getCode());
            for (AgentDefinition agent : relatedAgents) {
                if (agent.isEnabled()) {
                    agent.setEnabled(false);
                    agentDefinitionRepository.save(agent);
                    log.info("[CapabilityDefinitionService] Cascade disabled agent '{}' due to capability '{}' disabled",
                            agent.getCode(), cap.getCode());
                }
            }
        }
    }
}
