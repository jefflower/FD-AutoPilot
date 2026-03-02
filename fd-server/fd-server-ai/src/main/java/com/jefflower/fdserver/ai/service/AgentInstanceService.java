package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.entity.AgentInstance;
import com.jefflower.fdserver.ai.repository.AgentInstanceRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Slf4j
@Service
public class AgentInstanceService {

    private final AgentInstanceRepository instanceRepo;

    public AgentInstanceService(AgentInstanceRepository instanceRepo) {
        this.instanceRepo = instanceRepo;
    }

    /**
     * Get all instances.
     */
    public List<AgentInstance> getAllInstances() {
        return instanceRepo.findAll();
    }

    /**
     * Get all instances for a specific client.
     */
    public List<AgentInstance> getInstancesByClientId(String clientId) {
        return instanceRepo.findByClientId(clientId);
    }

    /**
     * Get all instances for a specific agent code.
     */
    public List<AgentInstance> getInstancesByAgentCode(String agentCode) {
        return instanceRepo.findByAgentCode(agentCode);
    }

    /**
     * Get online instances for a specific agent code (heartbeat within 60s).
     */
    public List<AgentInstance> getOnlineInstances(String agentCode) {
        LocalDateTime cutoff = LocalDateTime.now().minusSeconds(60);
        return instanceRepo.findOnlineInstancesByAgentCode(agentCode, cutoff);
    }

    /**
     * Update the localConfig for an agent instance.
     */
    @Transactional
    public AgentInstance updateLocalConfig(Long id, String localConfig) {
        AgentInstance instance = instanceRepo.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.AGENT_NOT_FOUND,
                        "AgentInstance not found: " + id));
        instance.setLocalConfig(localConfig);
        return instanceRepo.save(instance);
    }
}
