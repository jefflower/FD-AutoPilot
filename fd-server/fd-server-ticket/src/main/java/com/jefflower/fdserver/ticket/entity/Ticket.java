package com.jefflower.fdserver.ticket.entity;

import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.enums.TicketStatusConverter;
import jakarta.persistence.*;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import org.hibernate.Hibernate;

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

    @Version
    @Column(columnDefinition = "BIGINT DEFAULT 0")
    private Long version = 0L;

    @Column(name = "external_id", unique = true, nullable = false, length = 64)
    private String externalId;

    @Column(columnDefinition = "TEXT")
    private String subject;

    @Column(columnDefinition = "TEXT")
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

    @Column(name = "last_audit_remark", columnDefinition = "TEXT")
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

    // ========== 工单来源 ==========

    /** 工单来源：FRESHDESK / MANUAL 等 */
    @Column(name = "origin", length = 32)
    private String origin;

    /** AI 分类类别 */
    @Column(name = "ticket_category", length = 32)
    private String ticketCategory;

    /** 客户订单号（物流查询类工单，由翻译 Agent 提取） */
    @Column(name = "order_number", length = 64)
    private String orderNumber;

    /** 物流追踪号（物流查询类工单，由翻译 Agent 提取） */
    @Column(name = "tracking_number", length = 128)
    private String trackingNumber;

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
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Set<TicketTranslation> translations;

    @OneToMany(mappedBy = "ticket", fetch = FetchType.LAZY)
    @OrderBy("createdAt DESC")
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Set<TicketReply> replies;

    /** 返回最新的翻译记录；未加载时安全返回 null */
    @com.fasterxml.jackson.annotation.JsonProperty("translation")
    public TicketTranslation getTranslation() {
        if (translations == null || !Hibernate.isInitialized(translations) || translations.isEmpty())
            return null;
        return translations.stream()
                .sorted((a, b) -> b.getId().compareTo(a.getId()))
                .findFirst()
                .orElse(null);
    }

    /** 返回回复列表；未加载时安全返回 null */
    @com.fasterxml.jackson.annotation.JsonProperty("replies")
    public Set<TicketReply> getLoadedReplies() {
        if (replies == null || !Hibernate.isInitialized(replies))
            return null;
        return replies;
    }

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
