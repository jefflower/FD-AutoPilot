package com.jefflower.fdserver.ticket.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 失败的回复推送记录
 * 用于在 pushReplyToFreshdesk 失败时记录，由定时器重试
 */
@Data
@Entity
@Table(name = "failed_reply_push")
public class FailedReplyPush {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "ticket_id", nullable = false)
    private Long ticketId;

    @Column(name = "external_id", nullable = false, length = 64)
    private String externalId;

    @Column(name = "reply_id", nullable = false)
    private Long replyId;

    @Column(name = "retry_count")
    private Integer retryCount = 0;

    @Column(name = "max_retries")
    private Integer maxRetries = 5;

    @Column(name = "next_retry_at")
    private LocalDateTime nextRetryAt;

    @Column(name = "last_error", length = 1024)
    private String lastError;

    @Column(name = "status", length = 16)
    private String status = "PENDING";

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
