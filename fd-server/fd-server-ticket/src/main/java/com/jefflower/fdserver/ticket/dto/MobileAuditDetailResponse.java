package com.jefflower.fdserver.ticket.dto;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class MobileAuditDetailResponse {
    private Long ticketId;
    private String externalId;
    private String subject;
    private String content;             // 客户原文
    private String translatedTitle;
    private String translatedContent;   // 翻译内容
    private String zhReply;             // 中文回复
    private String targetReply;         // 目标语言回复
    private Long replyId;               // 回复 ID（提交审核时需要）
    private String status;              // 工单当前状态
    private String lastAuditRemark;     // 上次审核驳回意见
    private List<AuditHistoryItem> auditHistory;
    private boolean alreadyAudited;     // Token 是否已被使用

    @Data
    public static class AuditHistoryItem {
        private String auditResult;
        private String auditRemark;
        private LocalDateTime createdAt;
    }
}
