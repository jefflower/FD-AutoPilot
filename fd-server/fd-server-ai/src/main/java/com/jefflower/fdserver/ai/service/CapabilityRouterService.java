package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.dto.CapabilityRouteResult;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentInstance;
import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import com.jefflower.fdserver.ai.entity.ClientRegistration;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.AgentInstanceRepository;
import com.jefflower.fdserver.ai.repository.CapabilityDefinitionRepository;
import com.jefflower.fdserver.ai.repository.ClientRegistrationRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

/**
 * Capability 级路由服务。
 * <p>
 * 路由链路：
 * n8n 传入 capability → 查找 AgentDefinition.capability 匹配的 Agent →
 * 检查 requiredCapability 在客户端是否启用 → 选出可用 Agent + Client。
 * <p>
 * 路由策略优先级：
 * 1. 指定客户端优先：targetClientId 不为空时精确匹配
 * 2. Round-Robin：多个可用实例间轮转分配
 */
@Slf4j
@Service
public class CapabilityRouterService {

    private final AgentDefinitionRepository agentDefinitionRepository;
    private final AgentInstanceRepository agentInstanceRepository;
    private final ClientRegistrationRepository clientRegistrationRepository;
    private final CapabilityDefinitionRepository capabilityDefinitionRepository;

    /** 每个 capability 独立的 round-robin 计数器 */
    private final ConcurrentHashMap<String, AtomicInteger> roundRobinCounters = new ConcurrentHashMap<>();

    /** 每个 capability 最近一次路由结果（agentCode/clientId） */
    private final ConcurrentHashMap<String, String> lastRouteResults = new ConcurrentHashMap<>();

    public CapabilityRouterService(AgentDefinitionRepository agentDefinitionRepository,
                                   AgentInstanceRepository agentInstanceRepository,
                                   ClientRegistrationRepository clientRegistrationRepository,
                                   CapabilityDefinitionRepository capabilityDefinitionRepository) {
        this.agentDefinitionRepository = agentDefinitionRepository;
        this.agentInstanceRepository = agentInstanceRepository;
        this.clientRegistrationRepository = clientRegistrationRepository;
        this.capabilityDefinitionRepository = capabilityDefinitionRepository;
    }

    /**
     * 候选实例：绑定了 AgentDefinition + AgentInstance + requiredCapability 信息。
     */
    private record CandidateInstance(AgentDefinition agentDef, AgentInstance instance, String requiredCapability) {}

    /**
     * 根据业务 capability 路由到可用的 Agent + Client。
     * <p>
     * 路由策略：
     * <ol>
     *   <li>指定客户端优先：targetClientId 不为空时精确匹配</li>
     *   <li>Round-Robin：多个可用实例间轮转分配</li>
     * </ol>
     *
     * @param capability     业务意图（如 "translation", "reply"），对应 AgentDefinition.capability
     * @param targetClientId 指定客户端 ID（可为 null，不限定）
     * @param targetUserId   指定用户 ID（可为 null，不限定）
     * @return 路由结果
     */
    public CapabilityRouteResult route(String capability, String targetClientId, String targetUserId) {
        // 1. 查找所有匹配 capability 且 enabled 的 AgentDefinition（按 sortOrder 排序）
        List<AgentDefinition> agents = agentDefinitionRepository
                .findByCapabilityAndEnabledTrueOrderBySortOrder(capability);

        if (agents.isEmpty()) {
            log.warn("[CapabilityRouter] No enabled agent found for capability: {}", capability);
            throw new BusinessException(ErrorCode.CAPABILITY_NO_AGENT,
                    "该能力下无可用Agent: " + capability);
        }

        // 2. 收集所有可用的候选实例
        List<CandidateInstance> candidates = new ArrayList<>();
        boolean allCapabilityDisabled = true;
        LocalDateTime cutoff = LocalDateTime.now().minusSeconds(60);

        for (AgentDefinition agentDef : agents) {
            String reqCap = agentDef.getRequiredCapability();

            // 2a. 检查 requiredCapability 对应的 CapabilityDefinition 是否 enabled
            if (reqCap != null) {
                Optional<CapabilityDefinition> capOpt = capabilityDefinitionRepository.findByCode(reqCap);
                if (capOpt.isEmpty() || !capOpt.get().isEnabled()) {
                    log.debug("[CapabilityRouter] Agent {} requiredCapability '{}' is disabled or not found",
                            agentDef.getCode(), reqCap);
                    continue;
                }
                allCapabilityDisabled = false;
            } else {
                allCapabilityDisabled = false;
            }

            // 2b. 查找在线的 AgentInstance（lastHeartbeat > cutoff AND running = true）
            List<AgentInstance> onlineInstances = agentInstanceRepository
                    .findOnlineInstancesByAgentCode(agentDef.getCode(), cutoff);

            for (AgentInstance instance : onlineInstances) {
                // 2c. 应用 targetClientId 过滤
                if (targetClientId != null && !targetClientId.equals(instance.getClientId())) {
                    continue;
                }
                // 2c. 应用 targetUserId 过滤
                if (targetUserId != null && !targetUserId.equals(instance.getUserId())) {
                    continue;
                }

                // 2d. 检查 ClientRegistration 中客户端是否上报了该 requiredCapability
                if (reqCap != null) {
                    Optional<ClientRegistration> regOpt = clientRegistrationRepository.findById(instance.getClientId());
                    if (regOpt.isEmpty() || !regOpt.get().isOnline()) {
                        continue;
                    }
                    ClientRegistration reg = regOpt.get();
                    if (!hasCapability(reg, reqCap)) {
                        log.debug("[CapabilityRouter] Client {} does not report capability '{}', skipping",
                                instance.getClientId(), reqCap);
                        continue;
                    }
                }

                // 2e. 收集为候选实例
                candidates.add(new CandidateInstance(agentDef, instance, reqCap));
            }
        }

        // 3. 无候选实例 → 区分 CAPABILITY_DISABLED 和 NO_CLIENT_AVAILABLE
        if (candidates.isEmpty()) {
            if (allCapabilityDisabled) {
                log.warn("[CapabilityRouter] All agents for capability '{}' have disabled requiredCapability", capability);
                throw new BusinessException(ErrorCode.CAPABILITY_DISABLED,
                        "Capability '" + capability + "' 下所有 Agent 的底层执行能力已禁用");
            }
            log.warn("[CapabilityRouter] No online client available for capability: {}", capability);
            throw new BusinessException(ErrorCode.NO_CLIENT_AVAILABLE,
                    "无在线客户端可执行该能力: " + capability);
        }

        // 4. 路由策略选择
        CandidateInstance selected;
        String strategy;

        if (targetClientId != null && candidates.size() == 1) {
            // 指定客户端精确匹配，只有一个候选
            selected = candidates.get(0);
            strategy = "target-client";
        } else if (candidates.size() == 1) {
            // 只有一个候选实例，直接选择
            selected = candidates.get(0);
            strategy = "single";
        } else {
            // 多个候选实例，使用 Round-Robin 策略
            AtomicInteger counter = roundRobinCounters.computeIfAbsent(capability, k -> new AtomicInteger(0));
            int index = Math.abs(counter.getAndIncrement() % candidates.size());
            selected = candidates.get(index);
            strategy = "round-robin";
        }

        // 5. 记录路由结果
        AgentDefinition agentDef = selected.agentDef();
        AgentInstance instance = selected.instance();
        String reqCap = selected.requiredCapability();

        lastRouteResults.put(capability, agentDef.getCode() + "/" + instance.getClientId());

        log.info("[CapabilityRouter] 路由选择: capability={}, 可用实例={}, 选择={}/{}, 策略={}",
                capability, candidates.size(), agentDef.getCode(), instance.getClientId(), strategy);

        return new CapabilityRouteResult(
                agentDef.getCode(),
                instance.getClientId(),
                instance.getUserId(),
                reqCap,
                agentDef,
                instance
        );
    }

    /**
     * 获取路由统计信息，供 API 查询使用。
     * <p>
     * 返回内容包含：
     * <ul>
     *   <li>每个 capability 的当前可用实例数</li>
     *   <li>每个 capability 的 round-robin 计数器值</li>
     *   <li>每个 capability 的最近一次路由结果</li>
     * </ul>
     *
     * @return 路由统计信息
     */
    public Map<String, Object> getRouteStatistics() {
        Map<String, Object> stats = new LinkedHashMap<>();
        LocalDateTime cutoff = LocalDateTime.now().minusSeconds(60);

        // 查询所有启用的 capability → AgentDefinition 映射
        List<AgentDefinition> allAgents = agentDefinitionRepository.findAll().stream()
                .filter(AgentDefinition::isEnabled)
                .toList();

        // 按 capability 分组
        Map<String, List<AgentDefinition>> byCapability = allAgents.stream()
                .filter(a -> a.getCapability() != null)
                .collect(Collectors.groupingBy(AgentDefinition::getCapability));

        List<Map<String, Object>> capabilityStats = new ArrayList<>();

        for (Map.Entry<String, List<AgentDefinition>> entry : byCapability.entrySet()) {
            String capability = entry.getKey();
            List<AgentDefinition> agentDefs = entry.getValue();

            Map<String, Object> capStat = new LinkedHashMap<>();
            capStat.put("capability", capability);

            // 统计该 capability 下所有 agent 的在线实例
            int totalOnlineInstances = 0;
            List<Map<String, String>> instanceDetails = new ArrayList<>();

            for (AgentDefinition agentDef : agentDefs) {
                List<AgentInstance> onlineInstances = agentInstanceRepository
                        .findOnlineInstancesByAgentCode(agentDef.getCode(), cutoff);
                totalOnlineInstances += onlineInstances.size();

                for (AgentInstance inst : onlineInstances) {
                    Map<String, String> detail = new LinkedHashMap<>();
                    detail.put("agentCode", agentDef.getCode());
                    detail.put("clientId", inst.getClientId());
                    detail.put("userId", inst.getUserId() != null ? inst.getUserId() : "");
                    instanceDetails.add(detail);
                }
            }

            capStat.put("availableInstances", totalOnlineInstances);
            capStat.put("instances", instanceDetails);

            // round-robin 计数器
            AtomicInteger counter = roundRobinCounters.get(capability);
            capStat.put("roundRobinCounter", counter != null ? counter.get() : 0);

            // 最近路由结果
            capStat.put("lastRouteResult", lastRouteResults.getOrDefault(capability, "N/A"));

            capabilityStats.add(capStat);
        }

        stats.put("capabilities", capabilityStats);
        stats.put("totalCapabilities", byCapability.size());

        return stats;
    }

    /**
     * 检查 ClientRegistration 是否上报了指定 capability。
     * enabledCapabilities 字段存储格式为 JSON 数组（如 ["gemini-cli","notebooklm-py"]）
     * 或逗号分隔列表（向后兼容）。
     */
    private boolean hasCapability(ClientRegistration reg, String capabilityCode) {
        String enabledCaps = reg.getEnabledCapabilities();
        if (enabledCaps == null || enabledCaps.isBlank()) {
            return false;
        }
        // JSON 数组格式: ["gemini-cli","notebooklm-py"]
        String cleaned = enabledCaps.trim();
        if (cleaned.startsWith("[")) {
            cleaned = cleaned.substring(1);
            if (cleaned.endsWith("]")) {
                cleaned = cleaned.substring(0, cleaned.length() - 1);
            }
        }
        Set<String> caps = Arrays.stream(cleaned.split(","))
                .map(s -> s.trim().replace("\"", ""))
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toSet());
        return caps.contains(capabilityCode);
    }
}
