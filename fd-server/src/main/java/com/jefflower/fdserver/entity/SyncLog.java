package com.jefflower.fdserver.entity;

import com.jefflower.fdserver.enums.SyncStatus;
import com.jefflower.fdserver.enums.TriggerType;
import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 同步日志表
 * 记录每次同步的详细信息
 */
@Data
@Entity
@Table(name = "sync_log")
public class SyncLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "start_time", nullable = false)
    private LocalDateTime startTime;

    @Column(name = "end_time")
    private LocalDateTime endTime;

    @Column(name = "tickets_synced")
    private Integer ticketsSynced = 0;

    @Column(name = "tickets_updated")
    private Integer ticketsUpdated = 0;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16)
    private SyncStatus status = SyncStatus.RUNNING;

    @Enumerated(EnumType.STRING)
    @Column(name = "trigger_type", length = 16)
    private TriggerType triggerType;

    @Column(name = "error_message", length = 1024)
    private String errorMessage;
}
