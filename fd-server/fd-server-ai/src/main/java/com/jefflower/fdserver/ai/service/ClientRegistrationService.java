package com.jefflower.fdserver.ai.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ai.dto.ClientHeartbeatRequest;
import com.jefflower.fdserver.ai.dto.ClientHeartbeatResponse;
import com.jefflower.fdserver.ai.dto.ClientRegisterRequest;
import com.jefflower.fdserver.ai.dto.ClientRegisterResponse;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentInstance;
import com.jefflower.fdserver.ai.entity.ClientRegistration;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.AgentInstanceRepository;
import com.jefflower.fdserver.ai.repository.ClientRegistrationRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;

@Slf4j
@Service
public class ClientRegistrationService {

    /** 离线清理阈值：30 分钟无心跳视为离线需清理 */
    private static final int OFFLINE_CLEANUP_MINUTES = 30;

    private final ClientRegistrationRepository clientRepo;
    private final AgentInstanceRepository instanceRepo;
    private final AgentDefinitionRepository definitionRepo;
    private final ObjectMapper objectMapper;

    public ClientRegistrationService(ClientRegistrationRepository clientRepo,
                                     AgentInstanceRepository instanceRepo,
                                     AgentDefinitionRepository definitionRepo,
                                     ObjectMapper objectMapper) {
        this.clientRepo = clientRepo;
        this.instanceRepo = instanceRepo;
        this.definitionRepo = definitionRepo;
        this.objectMapper = objectMapper;
    }

    /**
     * Client registration (idempotent by clientId).
     * 同一 clientId 重新注册时更新而非新建，并清理该 clientId 之前的过期 AgentInstance。
     */
    @Transactional
    public ClientRegisterResponse register(String userId, ClientRegisterRequest req) {
        LocalDateTime now = LocalDateTime.now();

        // Upsert ClientRegistration
        ClientRegistration reg = clientRepo.findById(req.getClientId()).orElse(null);
        if (reg == null) {
            reg = new ClientRegistration();
            reg.setClientId(req.getClientId());
        }
        reg.setUserId(userId);
        reg.setClientType(req.getClientType());
        reg.setVersion(req.getVersion());
        reg.setEnabledCapabilities(toJson(req.getEnabledCapabilities()));
        reg.setLastHeartbeat(now);
        reg.setOnline(true);
        clientRepo.save(reg);

        // 清理该 clientId 之前的过期 AgentInstance（running=false 且 lastHeartbeat 过期的）
        LocalDateTime expiryCutoff = now.minusMinutes(OFFLINE_CLEANUP_MINUTES);
        List<AgentInstance> expiredInstances = instanceRepo
                .findByClientIdAndRunningFalseAndLastHeartbeatBefore(req.getClientId(), expiryCutoff);
        if (!expiredInstances.isEmpty()) {
            log.info("[ClientRegistration] 注册时清理过期 AgentInstance: clientId={}, count={}",
                    req.getClientId(), expiredInstances.size());
            instanceRepo.deleteAll(expiredInstances);
        }

        // Determine which capabilities are enabled
        Set<String> enabledCaps = req.getEnabledCapabilities() != null
                ? new HashSet<>(req.getEnabledCapabilities())
                : Collections.emptySet();
        Set<String> runningAgents = req.getRunningAgents() != null
                ? new HashSet<>(req.getRunningAgents())
                : Collections.emptySet();

        // Get all enabled AgentDefinitions
        List<AgentDefinition> allDefs = definitionRepo.findByEnabledTrueOrderBySortOrder();

        // Track matched agent codes for later cleanup
        Set<String> matchedAgentCodes = new HashSet<>();

        for (AgentDefinition def : allDefs) {
            // Only create instances for agents whose requiredCapability matches
            if (def.getRequiredCapability() != null && enabledCaps.contains(def.getRequiredCapability())) {
                matchedAgentCodes.add(def.getCode());

                AgentInstance instance = instanceRepo
                        .findByClientIdAndAgentCode(req.getClientId(), def.getCode())
                        .orElse(null);
                if (instance == null) {
                    instance = new AgentInstance();
                    instance.setClientId(req.getClientId());
                    instance.setAgentCode(def.getCode());
                }
                instance.setUserId(userId);
                instance.setRunning(runningAgents.contains(def.getCode()));
                instance.setLastHeartbeat(now);
                instance.setVersion(req.getVersion());
                instanceRepo.save(instance);
            }
        }

        // Mark unmatched existing instances as not running
        List<AgentInstance> existingInstances = instanceRepo.findByClientId(req.getClientId());
        for (AgentInstance inst : existingInstances) {
            if (!matchedAgentCodes.contains(inst.getAgentCode())) {
                inst.setRunning(false);
                instanceRepo.save(inst);
            }
        }

        int instanceCount = instanceRepo.findByClientId(req.getClientId()).size();
        int onlineClients = clientRepo.findByOnlineTrue().size();

        log.info("Client registered: clientId={}, userId={}, capabilities={}, instances={}",
                req.getClientId(), userId, enabledCaps, instanceCount);

        return new ClientRegisterResponse(req.getClientId(), instanceCount, onlineClients);
    }

    /**
     * Client heartbeat.
     * 返回服务端当前时间、该客户端关联的 Agent 数量、当前在线客户端总数。
     */
    @Transactional
    public ClientHeartbeatResponse heartbeat(String userId, ClientHeartbeatRequest req) {
        LocalDateTime now = LocalDateTime.now();

        ClientRegistration reg = clientRepo.findById(req.getClientId())
                .orElseThrow(() -> new BusinessException(ErrorCode.CLIENT_NOT_FOUND,
                        "Client not registered: " + req.getClientId()));
        reg.setLastHeartbeat(now);
        reg.setOnline(true);
        clientRepo.save(reg);

        // Update all instances for this client
        Set<String> runningAgents = req.getRunningAgents() != null
                ? new HashSet<>(req.getRunningAgents())
                : Collections.emptySet();

        List<AgentInstance> instances = instanceRepo.findByClientId(req.getClientId());
        for (AgentInstance inst : instances) {
            inst.setLastHeartbeat(now);
            inst.setRunning(runningAgents.contains(inst.getAgentCode()));
            instanceRepo.save(inst);
        }

        int registeredAgents = instances.size();
        int onlineClients = clientRepo.findByOnlineTrue().size();

        ClientHeartbeatResponse response = new ClientHeartbeatResponse(now, Collections.emptyList());
        response.setRegisteredAgents(registeredAgents);
        response.setOnlineClients(onlineClients);
        return response;
    }

    /**
     * 定时清理离线客户端（每 10 分钟执行一次）。
     * 清理 lastHeartbeat 超过 30 分钟的 ClientRegistration 记录，
     * 同时将对应的 AgentInstance 设置为 running=false。
     */
    @Scheduled(fixedRate = 600_000)
    @Transactional
    public void cleanupOfflineClients() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime cutoff = now.minusMinutes(OFFLINE_CLEANUP_MINUTES);

        List<ClientRegistration> offlineClients = clientRepo.findByLastHeartbeatBefore(cutoff);
        if (offlineClients.isEmpty()) {
            return;
        }

        for (ClientRegistration client : offlineClients) {
            long offlineMinutes = Duration.between(client.getLastHeartbeat(), now).toMinutes();
            log.info("[ClientRegistration] 清理离线客户端: clientId={}, lastHeartbeat={}, offlineMinutes={}",
                    client.getClientId(), client.getLastHeartbeat(), offlineMinutes);

            // 将该客户端的所有 AgentInstance 标记为 running=false
            int updatedCount = instanceRepo.markAllInstancesOfflineByClientId(client.getClientId(), now);
            if (updatedCount > 0) {
                log.info("[ClientRegistration] 已停止客户端 {} 的 {} 个 AgentInstance",
                        client.getClientId(), updatedCount);
            }

            // 标记客户端离线
            client.setOnline(false);
            clientRepo.save(client);
        }

        log.info("[ClientRegistration] 本次清理离线客户端总数: {}", offlineClients.size());
    }

    /**
     * Check if a client is online (heartbeat within 60s).
     */
    public boolean isClientOnline(String clientId) {
        return clientRepo.findById(clientId)
                .map(reg -> reg.isOnline() && reg.getLastHeartbeat() != null
                        && reg.getLastHeartbeat().isAfter(LocalDateTime.now().minusSeconds(60)))
                .orElse(false);
    }

    /**
     * Get all online clients.
     */
    public List<ClientRegistration> getOnlineClients() {
        return clientRepo.findByOnlineTrue();
    }

    private String toJson(Object obj) {
        if (obj == null) return null;
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception e) {
            log.warn("Failed to serialize to JSON: {}", e.getMessage());
            return null;
        }
    }
}
