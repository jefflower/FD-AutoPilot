package com.jefflower.fdserver.ai.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_workflow_version")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor
public class AiWorkflowVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long workflowId;

    @Column(nullable = false)
    private int versionNumber;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String workflowJson;

    @Column(length = 500)
    private String changeDescription;

    @Column(length = 64)
    private String createdBy;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
