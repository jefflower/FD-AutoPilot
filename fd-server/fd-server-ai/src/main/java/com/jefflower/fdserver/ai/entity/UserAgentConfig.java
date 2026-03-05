package com.jefflower.fdserver.ai.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_user_agent_config",
       uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "agent_code"}),
       indexes = {
           @Index(name = "idx_user_agent_user", columnList = "user_id"),
           @Index(name = "idx_user_agent_code", columnList = "agent_code")
       })
@Getter @Setter @NoArgsConstructor
public class UserAgentConfig {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false, length = 64)
    private String userId;

    @Column(name = "agent_code", nullable = false, length = 64)
    private String agentCode;

    /** 用户级自动启动（订阅时从 AgentDefinition.autoStart 继承默认值） */
    @Column(name = "auto_start", columnDefinition = "BOOLEAN NOT NULL DEFAULT false")
    private boolean autoStart = false;

    /** 用户是否启用该 Agent */
    @Column(columnDefinition = "BOOLEAN NOT NULL DEFAULT true")
    private boolean enabled = true;

    /** 订阅时间 */
    @Column(name = "subscribed_at")
    private LocalDateTime subscribedAt;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
        if (subscribedAt == null) {
            subscribedAt = LocalDateTime.now();
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
