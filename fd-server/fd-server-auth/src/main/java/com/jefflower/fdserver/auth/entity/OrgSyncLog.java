package com.jefflower.fdserver.auth.entity;

import com.jefflower.fdserver.auth.enums.OrgSyncStatus;
import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "org_sync_log")
public class OrgSyncLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 32)
    private String platform;

    @Column(name = "trigger_user", length = 64)
    private String triggerUser;

    @Column(name = "start_time")
    private LocalDateTime startTime;

    @Column(name = "end_time")
    private LocalDateTime endTime;

    @Column(name = "departments_created")
    private Integer departmentsCreated = 0;

    @Column(name = "departments_updated")
    private Integer departmentsUpdated = 0;

    @Column(name = "users_created")
    private Integer usersCreated = 0;

    @Column(name = "users_updated")
    private Integer usersUpdated = 0;

    @Column(name = "users_skipped")
    private Integer usersSkipped = 0;

    @Enumerated(EnumType.STRING)
    @Column(length = 32)
    private OrgSyncStatus status = OrgSyncStatus.RUNNING;

    @Column(name = "error_message", length = 2048)
    private String errorMessage;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
