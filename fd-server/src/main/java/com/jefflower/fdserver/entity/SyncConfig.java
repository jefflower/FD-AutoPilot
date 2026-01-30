package com.jefflower.fdserver.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 系统配置表
 * 用于存储同步相关配置（cron表达式、上次同步时间等）
 */
@Data
@Entity
@Table(name = "sync_config")
public class SyncConfig {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "config_key", unique = true, nullable = false, length = 64)
    private String configKey;

    @Column(name = "config_value", length = 512)
    private String configValue;

    @Column(name = "description", length = 256)
    private String description;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    // 配置键常量
    public static final String KEY_SYNC_CRON = "freshdesk_sync_cron";
    public static final String KEY_LAST_SYNC_TIME = "freshdesk_last_sync_time";
    public static final String KEY_SYNC_ENABLED = "freshdesk_sync_enabled";
}
