package com.jefflower.fdserver.ticket.entity;

import com.jefflower.fdserver.ticket.enums.KnowledgePermissionLevel;
import com.jefflower.fdserver.ticket.enums.KnowledgePermissionTarget;
import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "knowledge_permission", indexes = {
        @Index(name = "idx_kp_target", columnList = "target_type, target_id"),
        @Index(name = "idx_kp_user", columnList = "user_id")
})
public class KnowledgePermission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(name = "target_type", nullable = false, length = 20)
    private KnowledgePermissionTarget targetType;

    @Column(name = "target_id", nullable = false)
    private Long targetId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private KnowledgePermissionLevel permission;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
