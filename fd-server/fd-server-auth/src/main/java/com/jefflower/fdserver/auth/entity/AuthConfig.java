package com.jefflower.fdserver.auth.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "auth_config")
public class AuthConfig {
    @Id
    @Column(name = "config_key", length = 64)
    private String configKey;

    @Column(name = "config_value", length = 2048)
    private String configValue;

    @Column(length = 256)
    private String description;

    @Column(name = "is_secret")
    private Boolean isSecret = false;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();
}
