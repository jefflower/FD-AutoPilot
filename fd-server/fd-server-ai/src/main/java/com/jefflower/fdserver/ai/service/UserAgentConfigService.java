package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.dto.UserAgentConfigDTO;
import com.jefflower.fdserver.ai.dto.UserAgentConfigUpdateRequest;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.UserAgentConfig;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.UserAgentConfigRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@Service
public class UserAgentConfigService {

    private final UserAgentConfigRepository userAgentRepo;
    private final AgentDefinitionRepository definitionRepo;

    public UserAgentConfigService(UserAgentConfigRepository userAgentRepo,
                                   AgentDefinitionRepository definitionRepo) {
        this.userAgentRepo = userAgentRepo;
        this.definitionRepo = definitionRepo;
    }

    /**
     * 获取用户已订阅的 Agent 列表（含 AgentDefinition 摘要信息）
     */
    public List<UserAgentConfigDTO> getUserAgents(String userId) {
        List<UserAgentConfig> configs = userAgentRepo.findByUserId(userId);
        if (configs.isEmpty()) return List.of();

        // 批量查询所有 AgentDefinition（减少 N+1）
        Map<String, AgentDefinition> defMap = definitionRepo.findAllByOrderBySortOrder().stream()
                .collect(Collectors.toMap(AgentDefinition::getCode, d -> d, (a, b) -> a));

        return configs.stream().map(config -> {
            UserAgentConfigDTO dto = new UserAgentConfigDTO();
            dto.setAgentCode(config.getAgentCode());
            dto.setAutoStart(config.isAutoStart());
            dto.setEnabled(config.isEnabled());
            dto.setCustomConfig(config.getCustomConfig());
            dto.setSubscribedAt(config.getSubscribedAt());

            AgentDefinition def = defMap.get(config.getAgentCode());
            if (def != null) {
                dto.setAgentName(def.getName());
                dto.setDescription(def.getDescription());
                dto.setCapability(def.getCapability());
                dto.setRequiredCapability(def.getRequiredCapability());
                dto.setExecutionEnv(def.getExecutionEnv() != null ? def.getExecutionEnv().name() : null);
                dto.setGroupCode(def.getGroupCode());
                dto.setAgentEnabled(def.isEnabled());
                dto.setUserConfigSchema(def.getUserConfigSchema());
            }
            return dto;
        }).collect(Collectors.toList());
    }

    /**
     * 获取用户已订阅的 agentCode 列表（轻量查询，供心跳/Consumer 用）
     */
    public List<String> getUserAgentCodes(String userId) {
        return userAgentRepo.findByUserId(userId).stream()
                .filter(UserAgentConfig::isEnabled)
                .map(UserAgentConfig::getAgentCode)
                .collect(Collectors.toList());
    }

    /**
     * 订阅 Agent（自动批准，autoStart 继承 AgentDefinition 默认值）
     */
    @Transactional
    public UserAgentConfigDTO subscribe(String userId, String agentCode) {
        // 校验 Agent 存在且启用
        AgentDefinition def = definitionRepo.findByCode(agentCode)
                .orElseThrow(() -> new BusinessException(ErrorCode.AGENT_NOT_FOUND,
                        "Agent 不存在: " + agentCode));

        if (!def.isEnabled()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER,
                    "Agent 已禁用，无法订阅: " + agentCode);
        }

        // 检查是否已订阅
        if (userAgentRepo.existsByUserIdAndAgentCode(userId, agentCode)) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER,
                    "已订阅该 Agent: " + agentCode);
        }

        // 创建订阅记录
        UserAgentConfig config = new UserAgentConfig();
        config.setUserId(userId);
        config.setAgentCode(agentCode);
        config.setAutoStart(def.isAutoStart()); // 继承默认 autoStart
        config.setEnabled(true);
        userAgentRepo.save(config);

        log.info("[UserAgentConfig] 用户 {} 订阅 Agent {}, autoStart={}", userId, agentCode, def.isAutoStart());

        // 返回 DTO
        UserAgentConfigDTO dto = new UserAgentConfigDTO();
        dto.setAgentCode(config.getAgentCode());
        dto.setAutoStart(config.isAutoStart());
        dto.setEnabled(config.isEnabled());
        dto.setCustomConfig(config.getCustomConfig());
        dto.setSubscribedAt(config.getSubscribedAt());
        dto.setAgentName(def.getName());
        dto.setDescription(def.getDescription());
        dto.setCapability(def.getCapability());
        dto.setRequiredCapability(def.getRequiredCapability());
        dto.setExecutionEnv(def.getExecutionEnv() != null ? def.getExecutionEnv().name() : null);
        dto.setGroupCode(def.getGroupCode());
        dto.setAgentEnabled(def.isEnabled());
        dto.setUserConfigSchema(def.getUserConfigSchema());
        return dto;
    }

    /**
     * 退订 Agent
     */
    @Transactional
    public void unsubscribe(String userId, String agentCode) {
        UserAgentConfig config = userAgentRepo.findByUserIdAndAgentCode(userId, agentCode)
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_PARAMETER,
                        "未订阅该 Agent: " + agentCode));
        userAgentRepo.delete(config);
        log.info("[UserAgentConfig] 用户 {} 退订 Agent {}", userId, agentCode);
    }

    /**
     * 更新用户 Agent 配置（autoStart / enabled）
     */
    @Transactional
    public UserAgentConfigDTO updateConfig(String userId, String agentCode, UserAgentConfigUpdateRequest req) {
        UserAgentConfig config = userAgentRepo.findByUserIdAndAgentCode(userId, agentCode)
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_PARAMETER,
                        "未订阅该 Agent: " + agentCode));

        if (req.getAutoStart() != null) {
            config.setAutoStart(req.getAutoStart());
        }
        if (req.getEnabled() != null) {
            config.setEnabled(req.getEnabled());
        }
        if (req.getCustomConfig() != null) {
            config.setCustomConfig(req.getCustomConfig());
        }
        userAgentRepo.save(config);

        log.info("[UserAgentConfig] 用户 {} 更新 Agent {} 配置: autoStart={}, enabled={}",
                userId, agentCode, config.isAutoStart(), config.isEnabled());

        // 返回更新后的 DTO
        AgentDefinition def = definitionRepo.findByCode(agentCode).orElse(null);
        UserAgentConfigDTO dto = new UserAgentConfigDTO();
        dto.setAgentCode(config.getAgentCode());
        dto.setAutoStart(config.isAutoStart());
        dto.setEnabled(config.isEnabled());
        dto.setCustomConfig(config.getCustomConfig());
        dto.setSubscribedAt(config.getSubscribedAt());
        if (def != null) {
            dto.setAgentName(def.getName());
            dto.setDescription(def.getDescription());
            dto.setCapability(def.getCapability());
            dto.setRequiredCapability(def.getRequiredCapability());
            dto.setExecutionEnv(def.getExecutionEnv() != null ? def.getExecutionEnv().name() : null);
            dto.setGroupCode(def.getGroupCode());
            dto.setAgentEnabled(def.isEnabled());
            dto.setUserConfigSchema(def.getUserConfigSchema());
        }
        return dto;
    }
}
