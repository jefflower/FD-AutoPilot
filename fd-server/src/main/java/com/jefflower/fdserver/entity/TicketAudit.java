package com.jefflower.fdserver.entity;

import com.jefflower.fdserver.enums.AuditResult;
import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "ticket_audit")
public class TicketAudit {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "ticket_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Ticket ticket;

    @Column(name = "reply_id")
    private Long replyId;

    @Enumerated(EnumType.STRING)
    @Column(name = "audit_result", length = 16)
    private AuditResult auditResult;

    @Lob
    @Column(name = "audit_remark")
    private String auditRemark;

    @Column(name = "auditor_id")
    private Long auditorId;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
