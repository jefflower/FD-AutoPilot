package com.jefflower.fdserver.ticket.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.enums.TicketStatusConverter;
import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 工单状态转换历史日志
 * <p>
 * 记录每一次状态变更的来源、目标、触发者和备注，
 * 用于追踪工单生命周期中的所有状态转换。
 */
@Data
@Entity
@Table(name = "ticket_status_log", indexes = {
        @Index(name = "idx_status_log_ticket_id", columnList = "ticket_id"),
        @Index(name = "idx_status_log_created_at", columnList = "created_at")
})
public class TicketStatusLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ticket_id", nullable = false)
    private Ticket ticket;

    /**
     * 工单 ID（JSON 序列化时使用此字段替代完整的 ticket 关联，避免循环引用）
     */
    @Column(name = "ticket_id", insertable = false, updatable = false)
    private Long ticketId;

    /**
     * 转换前状态（首次创建工单时可为 null）
     */
    @Column(name = "from_status", length = 32)
    @Convert(converter = TicketStatusConverter.class)
    private TicketStatus fromStatus;

    /**
     * 转换后状态
     */
    @Column(name = "to_status", nullable = false, length = 32)
    @Convert(converter = TicketStatusConverter.class)
    private TicketStatus toStatus;

    /**
     * 触发者标识，例如：
     * - "n8n" — n8n 工作流触发
     * - "user:admin" — 用户操作
     * - "system:timeout" — 超时自动转换
     * - "system:rollback" — 失败回滚
     */
    @Column(name = "triggered_by", length = 64)
    private String triggeredBy;

    /**
     * 备注（如驳回原因、超时说明等）
     */
    @Column(length = 500)
    private String remark;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
