package com.jefflower.fdserver.ticket.dto;

import com.jefflower.fdserver.ticket.enums.AuditResult;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class AuditRequest {
    @NotNull(message = "回复ID不能为空")
    private Long replyId;

    @NotNull(message = "审核结果不能为空")
    private AuditResult auditResult;

    private String auditRemark;
}
