package com.jefflower.fdserver.ai.entity;

import com.jefflower.fdserver.ai.enums.ExecutionStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_agent_execution", indexes = {
        @Index(name = "idx_agent_exec_code", columnList = "agentCode"),
        @Index(name = "idx_agent_exec_time", columnList = "createdAt")
})
@Getter @Setter @NoArgsConstructor
public class AgentExecution {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String agentCode;

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    private ExecutionStatus status;

    private String referenceType;

    private Long referenceId;

    private String executedBy;

    private String executedOn;

    private Long durationMs;

    private Integer tokenCount;

    @Column(columnDefinition = "TEXT")
    private String inputSnapshot;

    @Column(columnDefinition = "TEXT")
    private String outputSnapshot;

    @Column(columnDefinition = "TEXT")
    private String errorMessage;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
