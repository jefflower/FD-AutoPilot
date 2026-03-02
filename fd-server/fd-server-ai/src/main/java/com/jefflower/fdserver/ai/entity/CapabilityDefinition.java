package com.jefflower.fdserver.ai.entity;

import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_capability_definition")
@Getter @Setter @NoArgsConstructor
public class CapabilityDefinition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 64)
    private String code;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(length = 500)
    private String description;

    /** 关联到前端 Executor 路由键 */
    @Column(nullable = false, length = 32, columnDefinition = "VARCHAR(32)")
    @Enumerated(EnumType.STRING)
    private ProviderType providerType;

    /** 环境检测配置 JSON */
    @Column(columnDefinition = "TEXT")
    private String detectConfig;

    /** 安装引导 JSON */
    @Column(columnDefinition = "TEXT")
    private String installGuide;

    /** 描述使用此 Capability 的 Agent 需要配置的额外参数（JSON Schema） */
    @Column(columnDefinition = "TEXT")
    private String configSchema;

    private boolean enabled = true;

    private boolean builtIn = false;

    private int sortOrder = 0;

    @Column(nullable = false, length = 32, columnDefinition = "VARCHAR(32)")
    @Enumerated(EnumType.STRING)
    private ExecutionEnv executionEnv = ExecutionEnv.CLIENT_ONLY;

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
