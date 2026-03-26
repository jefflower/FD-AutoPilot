package com.jefflower.fdserver.ticket.enums;

public enum TicketStatus {
    PENDING_TRANS,    // 待翻译
    TRANSLATING,      // 翻译中
    PENDING_REPLY,    // 待回复
    REPLYING,         // 回复中
    PROCESSING,       // 处理中（兼容旧数据，统一代表翻译/回复执行中）
    PENDING_AUDIT,    // 待审核
    AUDITING,         // 审核中
    APPROVED,         // 待推送
    MANUAL_REQUIRED,  // 需人工处理
    COMPLETED,        // 已完成
    SKIPPED;          // 无需处理（终态，可被数据同步重激活）

    /**
     * 字符串转枚举，直接调用 valueOf。
     */
    public static TicketStatus fromString(String value) {
        if (value == null) return null;
        return valueOf(value);
    }
}
