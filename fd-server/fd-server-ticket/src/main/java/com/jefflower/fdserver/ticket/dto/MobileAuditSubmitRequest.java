package com.jefflower.fdserver.ticket.dto;

import com.jefflower.fdserver.ticket.enums.AuditResult;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class MobileAuditSubmitRequest {
    @NotNull
    private AuditResult auditResult;
    private String auditRemark;
}
