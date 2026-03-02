package com.jefflower.fdserver.ai.repository;

import com.jefflower.fdserver.ai.entity.ClientRegistration;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface ClientRegistrationRepository extends JpaRepository<ClientRegistration, String> {

    List<ClientRegistration> findByOnlineTrue();

    List<ClientRegistration> findByUserId(String userId);

    @Modifying
    @Query("UPDATE ClientRegistration r SET r.online = false, r.updatedAt = :now WHERE r.lastHeartbeat < :cutoff AND r.online = true")
    int markOfflineClients(@Param("cutoff") LocalDateTime cutoff,
                           @Param("now") LocalDateTime now);

    /**
     * 查询 lastHeartbeat 早于 cutoff 的客户端记录（用于清理长期离线客户端）。
     */
    List<ClientRegistration> findByLastHeartbeatBefore(LocalDateTime cutoff);
}
