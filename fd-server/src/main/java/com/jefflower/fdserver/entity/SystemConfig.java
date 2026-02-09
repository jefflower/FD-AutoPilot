package com.jefflower.fdserver.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "system_config")
public class SystemConfig {
    @Id
    @Column(name = "config_key", length = 64)
    private String configKey;

    @Column(name = "config_value", length = 1024)
    private String configValue;

    @Column(name = "description", length = 256)
    private String description;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
