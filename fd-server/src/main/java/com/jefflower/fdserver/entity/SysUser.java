package com.jefflower.fdserver.entity;

import com.jefflower.fdserver.enums.UserRole;
import com.jefflower.fdserver.enums.UserStatus;
import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "sys_user")
public class SysUser {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 64)
    private String username;

    @Column(nullable = false, length = 128)
    private String password;

    @Enumerated(EnumType.STRING)
    @Column(length = 32)
    private UserRole role = UserRole.USER;

    @Enumerated(EnumType.STRING)
    @Column(length = 32)
    private UserStatus status = UserStatus.PENDING;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
