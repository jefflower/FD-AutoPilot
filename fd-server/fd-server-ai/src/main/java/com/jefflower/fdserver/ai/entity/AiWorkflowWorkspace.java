package com.jefflower.fdserver.ai.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_workflow_workspace")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor
public class AiWorkflowWorkspace {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long workflowId;

    @Column(length = 32, nullable = false)
    private String docType;

    @Column(length = 128)
    private String docTitle;

    @Column(length = 128)
    private String swaggerGroup;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String docContent;

    @Column(nullable = false)
    private int sortOrder = 0;

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
