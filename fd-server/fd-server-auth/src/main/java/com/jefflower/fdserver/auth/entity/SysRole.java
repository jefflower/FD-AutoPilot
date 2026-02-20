package com.jefflower.fdserver.auth.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "sys_role", indexes = {
        @Index(name = "idx_sys_role_code", columnList = "code", unique = true)
})
public class SysRole {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 32)
    private String code;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(length = 256)
    private String description;

    @Column(name = "built_in", nullable = false)
    private Boolean builtIn = false;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    public SysRole(String code, String name, String description, boolean builtIn) {
        this.code = code;
        this.name = name;
        this.description = description;
        this.builtIn = builtIn;
        this.createdAt = LocalDateTime.now();
    }
}
