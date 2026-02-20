package com.jefflower.fdserver.auth.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "user_app_settings",
        uniqueConstraints = {
                @UniqueConstraint(name = "uk_user_app_settings_user_app", columnNames = {"userId", "appCode"})
        },
        indexes = {
                @Index(name = "idx_user_app_settings_user_id", columnList = "userId")
        })
public class UserAppSettings {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;

    @Column(nullable = false, length = 64)
    private String appCode;

    @Column(columnDefinition = "TEXT")
    private String settingsJson;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();
}
