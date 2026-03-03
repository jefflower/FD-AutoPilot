package com.jefflower.fdserver.ticket.entity;

import com.jefflower.fdserver.ticket.enums.AuditTokenStatus;
import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "audit_token", indexes = {
    @Index(name = "idx_audit_token_token", columnList = "token", unique = true),
    @Index(name = "idx_audit_token_ticket_id", columnList = "ticket_id")
})
public class AuditToken {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String token;

    @Column(name = "ticket_id", nullable = false)
    private Long ticketId;

    @Enumerated(EnumType.STRING)
    @Column(length = 16, nullable = false)
    private AuditTokenStatus status = AuditTokenStatus.ACTIVE;

    @Column(name = "used_at")
    private LocalDateTime usedAt;

    @Column(name = "expire_at", nullable = false)
    private LocalDateTime expireAt;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();
}
