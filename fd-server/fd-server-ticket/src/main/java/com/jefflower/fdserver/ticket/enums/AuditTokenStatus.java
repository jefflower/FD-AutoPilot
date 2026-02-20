package com.jefflower.fdserver.ticket.enums;

public enum AuditTokenStatus {
    ACTIVE,   // 可用
    USED,     // 已使用（审核已完成）
    EXPIRED,  // 已过期
    REVOKED   // 已撤销
}
