package com.jefflower.fdserver.ai.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_agent_instance", indexes = {
        @Index(name = "idx_agent_inst_client", columnList = "client_id"),
        @Index(name = "idx_agent_inst_agent", columnList = "agent_code"),
        @Index(name = "idx_agent_inst_client_agent", columnList = "client_id, agent_code", unique = true)
})
@Getter @Setter @NoArgsConstructor
public class AgentInstance {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "client_id", nullable = false, length = 64)
    private String clientId;

    @Column(name = "user_id", length = 64)
    private String userId;

    @Column(name = "agent_code", nullable = false, length = 64)
    private String agentCode;

    @Column(name = "local_config", columnDefinition = "TEXT")
    private String localConfig;

    private boolean running = false;

    @Column(name = "last_heartbeat")
    private LocalDateTime lastHeartbeat;

    @Column(length = 32)
    private String version;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
