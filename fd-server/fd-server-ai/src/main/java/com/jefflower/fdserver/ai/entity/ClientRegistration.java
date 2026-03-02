package com.jefflower.fdserver.ai.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_client_registration")
@Getter @Setter @NoArgsConstructor
public class ClientRegistration {

    @Id
    @Column(name = "client_id", length = 64)
    private String clientId;

    @Column(name = "user_id", length = 64)
    private String userId;

    @Column(name = "client_type", length = 32)
    private String clientType;

    @Column(length = 32)
    private String version;

    @Column(name = "enabled_capabilities", columnDefinition = "TEXT")
    private String enabledCapabilities;

    @Column(name = "last_heartbeat")
    private LocalDateTime lastHeartbeat;

    private boolean online = false;

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
