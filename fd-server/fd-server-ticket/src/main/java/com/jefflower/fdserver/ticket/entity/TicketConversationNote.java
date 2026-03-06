package com.jefflower.fdserver.ticket.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 工单对话标注
 * <p>
 * 允许用户在工单的某一条 Freshdesk 对话上添加标注（如视频审查结论、补充说明等）。
 * conversationId 对应 TicketContent.ConversationDto.id（Freshdesk 对话 ID）。
 * 标注内容会作为上下文传递给 AI Agent，辅助生成更准确的回复。
 */
@Data
@Entity
@Table(name = "ticket_conversation_note", indexes = {
        @Index(name = "idx_conv_note_ticket_id", columnList = "ticket_id"),
        @Index(name = "idx_conv_note_conversation_id", columnList = "conversation_id"),
        @Index(name = "idx_conv_note_ticket_conv", columnList = "ticket_id, conversation_id")
})
public class TicketConversationNote {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ticket_id", nullable = false)
    private Ticket ticket;

    /**
     * 工单 ID（JSON 序列化时使用，避免循环引用）
     */
    @Column(name = "ticket_id", insertable = false, updatable = false)
    private Long ticketId;

    /**
     * Freshdesk 对话 ID，对应 TicketContent.ConversationDto.id
     */
    @Column(name = "conversation_id", nullable = false)
    private Long conversationId;

    /**
     * 标注内容（如视频审查结论、补充说明等）
     */
    @Column(name = "note_content", nullable = false, columnDefinition = "TEXT")
    private String noteContent;

    /**
     * 标注类型（预留扩展，如 VIDEO_REVIEW / GENERAL / CORRECTION 等）
     */
    @Column(name = "note_type", length = 32)
    private String noteType = "GENERAL";

    /**
     * 创建者（用户名或 "system"）
     */
    @Column(name = "created_by", length = 64)
    private String createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
