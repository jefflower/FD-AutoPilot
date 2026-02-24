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

    @Column(nullable = false, length = 32, columnDefinition = "VARCHAR(32)")
    @Enumerated(EnumType.STRING)
    private ProviderType providerType;

    @Column(nullable = false, length = 32, columnDefinition = "VARCHAR(32)")
    @Enumerated(EnumType.STRING)
    private ExecutionEnv executionEnv;

    @Column(nullable = false, length = 64)
    private String capability;

    @Column(length = 64)
    private String groupCode;

    @Column(length = 16)
    @Enumerated(EnumType.STRING)
    private CallMode callMode;

    @Column(length = 500)
    private String callUrl;

    @Column(columnDefinition = "TEXT")
    private String providerConfig;

    @Column(columnDefinition = "TEXT")
    private String inputSchema;

    @Column(columnDefinition = "TEXT")
    private String outputSchema;

    @Column(length = 50)
    private String templateEngine;

    private boolean enabled = true;

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
