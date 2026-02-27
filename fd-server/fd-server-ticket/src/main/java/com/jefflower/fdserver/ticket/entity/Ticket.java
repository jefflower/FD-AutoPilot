package com.jefflower.fdserver.ticket.entity;

import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.enums.TicketStatusConverter;
import jakarta.persistence.*;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import java.time.LocalDateTime;
import java.util.Set;

@Data
@EqualsAndHashCode(exclude = {"translations", "replies"})
@ToString(exclude = {"translations", "replies"})
@Entity
@Table(name = "ticket", indexes = {
        @Index(name = "idx_ticket_status", columnList = "status"),
        @Index(name = "idx_ticket_external_id", columnList = "external_id"),
        @Index(name = "idx_ticket_created_at", columnList = "created_at"),
        @Index(name = "idx_ticket_is_valid", columnList = "is_valid"),
        @Index(name = "idx_ticket_status_created_at", columnList = "status, created_at"),
        @Index(name = "idx_ticket_status_updated_at", columnList = "status, updated_at")
})
public class Ticket {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "external_id", unique = true, nullable = false, length = 64)
    private String externalId;

    @Lob
    private String subject;

    @Lob
    private String content;

    @Column(name = "source_lang", length = 16)
    private String sourceLang;

    @Convert(converter = TicketStatusConverter.class)
    @Column(columnDefinition = "VARCHAR(32)")
    private TicketStatus status = TicketStatus.PENDING_TRANS;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "is_valid")
    private Boolean isValid = false;

    @Lob
    @Column(name = "last_audit_remark")
    private String lastAuditRemark;

    // ========== Freshdesk 原生元数据 ==========

    @Column(name = "fd_status")
    private Integer fdStatus;

    @Column(name = "fd_priority")
    private Integer fdPriority;

    @Column(name = "fd_source")
    private Integer fdSource;

    @Column(name = "fd_type", length = 64)
    private String fdType;

    @Column(name = "fd_requester_id")
    private Long fdRequesterId;

    @Column(name = "fd_responder_id")
    private Long fdResponderId;

    @Column(name = "fd_group_id")
    private Long fdGroupId;

    @Column(name = "fd_tags", length = 512)
    private String fdTags;

    @Column(name = "fd_created_at")
    private LocalDateTime fdCreatedAt;

    @Column(name = "fd_updated_at")
    private LocalDateTime fdUpdatedAt;

    // ========== 同步控制字段 ==========

    @Column(name = "content_hash", length = 64)
    private String contentHash;

    @Column(name = "last_synced_at")
    private LocalDateTime lastSyncedAt;

    @Column(name = "sync_source", length = 16)
    private String syncSource;

    // ========== 关联关系 ==========

    @OneToMany(mappedBy = "ticket", fetch = FetchType.LAZY)
    @OrderBy("id DESC")
    private Set<TicketTranslation> translations;

    @OneToMany(mappedBy = "ticket", fetch = FetchType.LAZY)
    @OrderBy("createdAt DESC")
    private Set<TicketReply> replies;

    @com.fasterxml.jackson.annotation.JsonProperty("translation")
    public TicketTranslation getTranslation() {
        if (translations == null || translations.isEmpty())
            return null;
        return translations.stream()
                .sorted((a, b) -> b.getId().compareTo(a.getId()))
                .findFirst()
                .orElse(null);
    }

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
