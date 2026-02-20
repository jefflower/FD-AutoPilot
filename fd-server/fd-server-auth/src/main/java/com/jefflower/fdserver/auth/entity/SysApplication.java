package com.jefflower.fdserver.auth.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 系统应用实体。
 * <p>
 * 用于多应用支持，每个应用有唯一 code 标识（如 "fd-web", "fd-admin", "fd-api"）。
 * builtIn 为 true 的应用不可删除。
 */
@Data
@NoArgsConstructor
@Entity
@Table(name = "sys_application", indexes = {
        @Index(name = "idx_sys_application_code", columnList = "code", unique = true)
})
public class SysApplication {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 50)
    private String code;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 256)
    private String description;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "built_in", nullable = false)
    private boolean builtIn = false;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
    }

    public SysApplication(String code, String name, String description, boolean builtIn) {
        this.code = code;
        this.name = name;
        this.description = description;
        this.builtIn = builtIn;
        this.enabled = true;
    }
}
