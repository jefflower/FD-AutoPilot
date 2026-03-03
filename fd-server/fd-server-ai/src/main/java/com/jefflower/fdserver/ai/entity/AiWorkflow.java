package com.jefflower.fdserver.ai.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_workflow")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor
public class AiWorkflow {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(length = 500)
    private String description;

    @Column(length = 64)
    private String n8nWorkflowId;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String currentJson;

    @Column(nullable = false)
    private int currentVersion = 0;

    @Column(length = 32, nullable = false)
    private String status = "DRAFT";

    @Column(length = 64)
    private String createdBy;

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
