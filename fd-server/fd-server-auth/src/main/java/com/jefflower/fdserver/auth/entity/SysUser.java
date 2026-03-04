package com.jefflower.fdserver.auth.entity;

import com.jefflower.fdserver.auth.enums.UserStatus;
import com.jefflower.fdserver.auth.enums.UserType;
import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

@Data
@Entity
@Table(name = "sys_user", indexes = {
        @Index(name = "idx_sys_user_username", columnList = "username"),
        @Index(name = "idx_sys_user_status", columnList = "status"),
        @Index(name = "idx_sys_user_dingtalk", columnList = "dingtalk_user_id"),
        @Index(name = "idx_sys_user_wecom", columnList = "wecom_user_id")
})
public class SysUser {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 64)
    private String username;

    @JsonIgnore
    @Column(nullable = false, length = 128)
    private String password;

    @Enumerated(EnumType.STRING)
    @Column(length = 32)
    private UserStatus status = UserStatus.PENDING;

    @Enumerated(EnumType.STRING)
    @Column(name = "user_type", length = 20)
    private UserType userType = UserType.INTERNAL;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    // ====== 外部平台关联字段 ======

    @Column(name = "dingtalk_user_id", length = 128)
    private String dingtalkUserId;

    @Column(name = "wecom_user_id", length = 128)
    private String wecomUserId;

    @Column(name = "display_name", length = 128)
    private String displayName;

    @Column(name = "avatar", length = 512)
    private String avatar;

    @Column(name = "mobile", length = 32)
    private String mobile;

    @Column(name = "email", length = 128)
    private String email;

    @Column(name = "department_id")
    private Long departmentId;

    @Column(name = "external_sync_at")
    private LocalDateTime externalSyncAt;

    // ====== 非持久化字段（用于 API 响应） ======

    /** 用户角色代码列表，由 Service 层填充，不持久化到数据库 */
    @Transient
    private List<String> roles;
}
