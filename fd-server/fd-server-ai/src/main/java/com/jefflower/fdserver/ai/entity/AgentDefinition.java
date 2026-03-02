package com.jefflower.fdserver.ai.entity;

import com.jefflower.fdserver.ai.enums.CallMode;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_agent_definition")
@Getter @Setter @NoArgsConstructor
public class AgentDefinition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 64)
    private String code;

    @Column(nullable = false)
    private String name;

    @Column(length = 500)
    private String description;

    @Column(length = 32, columnDefinition = "VARCHAR(32)")
    @Enumerated(EnumType.STRING)
    private ProviderType providerType;

    @Column(length = 32, columnDefinition = "VARCHAR(32)")
    @Enumerated(EnumType.STRING)
    private ExecutionEnv executionEnv;

    @Column(nullable = false, length = 64)
    private String capability;

    @Column(length = 64)
    private String groupCode;

    /** 所需的底层执行能力编码，引用 CapabilityDefinition.code */
    @Column(length = 64)
    private String requiredCapability;

    @Column(length = 16)
    @Enumerated(EnumType.STRING)
    private CallMode callMode;

    @Column(length = 500)
    private String callUrl;

    @Column(name = "provider_config", columnDefinition = "TEXT")
    private String agentConfig;

    @Column(columnDefinition = "TEXT")
    private String inputSchema;

    @Column(columnDefinition = "TEXT")
    private String outputSchema;

    @Column(length = 50)
    private String templateEngine;

    @Column(columnDefinition = "TEXT")
    private String systemPrompt;

    private boolean enabled = true;

    /** 前端加载后自动启动 MQ Consumer */
    @Column(columnDefinition = "BOOLEAN NOT NULL DEFAULT false")
    private boolean autoStart = false;

    private int sortOrder = 0;

    private boolean builtIn = false;

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
