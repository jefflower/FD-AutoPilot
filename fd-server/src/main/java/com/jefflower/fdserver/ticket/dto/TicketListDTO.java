package com.jefflower.fdserver.ticket.dto;

import com.jefflower.fdserver.ticket.enums.TicketStatus;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 工单列表 DTO — 仅包含列表页展示所需的轻量字段。
 * 排除大字段 content、lastAuditRemark，以及关联的 translations/replies，
 * 显著降低列表查询的数据库 I/O 和网络传输量。
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class TicketListDTO {
    private Long id;
    private String externalId;
    private String subject;
    private TicketStatus status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Boolean isValid;

    // 翻译标题（来自最新的 TicketTranslation，用于列表中文显示模式）
    private String translatedTitle;

    // Freshdesk 元数据（列表中常用于筛选/展示）
    private Integer fdStatus;
    private Integer fdPriority;
    private Long fdRequesterId;
    private Long fdResponderId;
    private String fdTags;
    private LocalDateTime fdCreatedAt;
    private LocalDateTime fdUpdatedAt;
}
