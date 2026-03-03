package com.jefflower.fdserver.ticket.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * Webhook 事件去重记录。
 * 对 Freshdesk Webhook 请求 body 计算 SHA-256 hash 作为 eventId，
 * 防止同一事件被重复处理。
 */
@Data
@Entity
@Table(name = "webhook_event", indexes = {
        @Index(name = "idx_webhook_event_id", columnList = "eventId", unique = true),
        @Index(name = "idx_webhook_event_received_at", columnList = "receivedAt")
})
public class WebhookEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Webhook 事件唯一 ID（格式：webhook:{sha256-hash}） */
    @Column(nullable = false, unique = true)
    private String eventId;

    /** 事件类型：ticket_created, ticket_updated 等 */
    @Column(nullable = false, length = 64)
    private String eventType;

    /** 关联的工单外部 ID */
    @Column(length = 64)
    private String ticketExternalId;

    /** 接收时间 */
    @Column(nullable = false)
    private LocalDateTime receivedAt;

    /** 是否已处理完成 */
    @Column(nullable = false)
    private boolean processed;
}
