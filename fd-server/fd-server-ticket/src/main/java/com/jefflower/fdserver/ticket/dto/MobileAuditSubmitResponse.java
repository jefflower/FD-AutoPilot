package com.jefflower.fdserver.ticket.dto;

import lombok.Data;

@Data
public class MobileAuditSubmitResponse {
    private boolean success;
    private String message;
    private String auditResult;

    public static MobileAuditSubmitResponse ok(String message, String auditResult) {
        MobileAuditSubmitResponse r = new MobileAuditSubmitResponse();
        r.setSuccess(true);
        r.setMessage(message);
        r.setAuditResult(auditResult);
        return r;
    }

    public static MobileAuditSubmitResponse fail(String message) {
        MobileAuditSubmitResponse r = new MobileAuditSubmitResponse();
        r.setSuccess(false);
        r.setMessage(message);
        return r;
    }
}
