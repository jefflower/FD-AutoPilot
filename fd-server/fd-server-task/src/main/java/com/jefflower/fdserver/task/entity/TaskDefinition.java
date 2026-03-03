package com.jefflower.fdserver.task.entity;

import com.jefflower.fdserver.task.enums.ExecutionMode;
import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "task_definition", indexes = {
        @Index(name = "idx_task_def_code", columnList = "code")
})
public class TaskDefinition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 64, unique = true, nullable = false)
    private String code;

    @Column(length = 128, nullable = false)
    private String name;

    @Column(length = 256)
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(name = "execution_mode", nullable = false, columnDefinition = "VARCHAR(32)")
    private ExecutionMode executionMode;

    @Column(name = "cron_expression", length = 64)
    private String cronExpression;

    @Column(name = "timeout_seconds")
    private int timeoutSeconds = 300;

    @Column(name = "max_retries")
    private int maxRetries = 3;

    @Column(name = "max_concurrency")
    private int maxConcurrency = 5;

    private boolean enabled = true;

    @Column(name = "handler_name", length = 64)
    private String handlerName;

    @Column(columnDefinition = "TEXT")
    private String config;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
