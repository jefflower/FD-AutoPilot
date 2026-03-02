package com.jefflower.fdserver.task.entity;

import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.enums.TriggerType;
import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "task_instance", indexes = {
        @Index(name = "idx_task_inst_type_status", columnList = "task_type, status"),
        @Index(name = "idx_task_inst_assigned", columnList = "assigned_to"),
        @Index(name = "idx_task_inst_ref", columnList = "reference_type, reference_id"),
        @Index(name = "idx_task_inst_created", columnList = "created_at")
})
public class TaskInstance {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "task_type", length = 64, nullable = false)
    private String taskType;

    @Column(name = "reference_type", length = 64)
    private String referenceType;

    @Column(name = "reference_id", length = 64)
    private String referenceId;

    @Enumerated(EnumType.STRING)
    @Column(columnDefinition = "VARCHAR(32)")
    private TaskStatus status = TaskStatus.PENDING;

    @Enumerated(EnumType.STRING)
    @Column(name = "trigger_type", columnDefinition = "VARCHAR(32)")
    private TriggerType triggerType = TriggerType.EVENT;

    @Column(name = "assigned_to", length = 64)
    private String assignedTo;

    @Column(name = "assigned_at")
    private LocalDateTime assignedAt;

    @Column(columnDefinition = "TEXT")
    private String payload;

    @Column(columnDefinition = "TEXT")
    private String result;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "retry_count")
    private int retryCount = 0;

    @Column(name = "target_client_id", length = 64)
    private String targetClientId;

    @Column(name = "target_user_id", length = 64)
    private String targetUserId;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;
}
