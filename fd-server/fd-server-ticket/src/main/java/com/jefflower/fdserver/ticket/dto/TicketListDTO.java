package com.jefflower.fdserver.ticket.dto;

import com.jefflower.fdserver.ticket.enums.TicketStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 工单列表 DTO — 仅包含列表页展示所需的轻量字段。
 * 排除大字段 content、lastAuditRemark，以及关联的 translations/replies，
 * 显著降低列表查询的数据库 I/O 和网络传输量。
 */
@Schema(description = "工单列表轻量 DTO（不含大字段 content 和关联数据）")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class TicketListDTO {
    @Schema(description = "工单 ID")
    private Long id;

    @Schema(description = "Freshdesk 外部工单 ID")
    private String externalId;

    @Schema(description = "工单标题")
    private String subject;

    @Schema(description = "工单状态")
    private TicketStatus status;

    @Schema(description = "创建时间")
    private LocalDateTime createdAt;

    @Schema(description = "更新时间")
    private LocalDateTime updatedAt;

    @Schema(description = "知识库有效性标记")
    private Boolean isValid;

    @Schema(description = "翻译标题（来自最新的 TicketTranslation，用于列表中文显示模式）")
    private String translatedTitle;

    @Schema(description = "Freshdesk 工单状态码")
    private Integer fdStatus;

    @Schema(description = "Freshdesk 优先级")
    private Integer fdPriority;

    @Schema(description = "Freshdesk 请求者 ID")
    private Long fdRequesterId;

    @Schema(description = "Freshdesk 响应者 ID")
    private Long fdResponderId;

    @Schema(description = "Freshdesk 标签（逗号分隔）")
    private String fdTags;

    @Schema(description = "Freshdesk 创建时间")
    private LocalDateTime fdCreatedAt;

    @Schema(description = "Freshdesk 更新时间")
    private LocalDateTime fdUpdatedAt;
}
