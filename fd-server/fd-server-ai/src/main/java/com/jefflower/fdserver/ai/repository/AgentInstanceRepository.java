package com.jefflower.fdserver.ai.repository;

import com.jefflower.fdserver.ai.entity.AgentInstance;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface AgentInstanceRepository extends JpaRepository<AgentInstance, Long> {

    Optional<AgentInstance> findByClientIdAndAgentCode(String clientId, String agentCode);

    List<AgentInstance> findByClientId(String clientId);

    List<AgentInstance> findByAgentCode(String agentCode);

    List<AgentInstance> findByAgentCodeAndRunningTrue(String agentCode);

    List<AgentInstance> findByClientIdAndRunningTrue(String clientId);

    @Modifying
    @Query("UPDATE AgentInstance i SET i.running = false, i.updatedAt = :now WHERE i.clientId = :clientId AND i.lastHeartbeat < :cutoff")
    int markOfflineInstances(@Param("clientId") String clientId,
                             @Param("cutoff") LocalDateTime cutoff,
                             @Param("now") LocalDateTime now);

    @Query("SELECT i FROM AgentInstance i WHERE i.agentCode = :agentCode AND i.running = true AND i.lastHeartbeat > :cutoff")
    List<AgentInstance> findOnlineInstancesByAgentCode(@Param("agentCode") String agentCode,
                                                       @Param("cutoff") LocalDateTime cutoff);

    /**
     * 将指定 clientId 的所有 AgentInstance 的 running 设为 false。
     */
    @Modifying
    @Query("UPDATE AgentInstance i SET i.running = false, i.updatedAt = :now WHERE i.clientId = :clientId AND i.running = true")
    int markAllInstancesOfflineByClientId(@Param("clientId") String clientId,
                                           @Param("now") LocalDateTime now);

    /**
     * 查询指定 clientId 下 running=false 且 lastHeartbeat 早于 cutoff 的过期实例。
     */
    List<AgentInstance> findByClientIdAndRunningFalseAndLastHeartbeatBefore(String clientId, LocalDateTime cutoff);
}
