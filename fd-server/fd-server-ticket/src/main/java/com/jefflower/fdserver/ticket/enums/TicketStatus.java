package com.jefflower.fdserver.ticket.enums;

public enum TicketStatus {
    PENDING_TRANS,
    PROCESSING,
    PENDING_AUDIT,
    AUDITING,
    APPROVED,
    COMPLETED;

    /**
     * 向后兼容：数据库中旧记录可能仍有 TRANSLATING/PENDING_REPLY/REPLYING，
     * 反序列化时统一映射到 PROCESSING。
     */
    public static TicketStatus fromString(String value) {
        if (value == null) return null;
        return switch (value) {
            case "TRANSLATING", "PENDING_REPLY", "REPLYING" -> PROCESSING;
            default -> valueOf(value);
        };
    }
}
