package com.jefflower.fdserver.auth.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "sys_permission", indexes = {
        @Index(name = "idx_sys_permission_code", columnList = "code", unique = true),
        @Index(name = "idx_sys_permission_module", columnList = "module")
})
public class SysPermission {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 64)
    private String code;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(nullable = false, length = 32)
    private String module;

    @Column(length = 256)
    private String description;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    public SysPermission(String code, String name, String module) {
        this.code = code;
        this.name = name;
        this.module = module;
        this.createdAt = LocalDateTime.now();
    }
}
