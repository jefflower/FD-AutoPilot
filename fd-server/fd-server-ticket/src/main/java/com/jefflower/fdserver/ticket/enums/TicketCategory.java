package com.jefflower.fdserver.ticket.enums;

public enum TicketCategory {
    PRODUCT_FAULT("产品故障"),
    LOGISTICS_INQUIRY("物流查询"),
    BUSINESS_COOPERATION("商务合作"),
    COMPLETED("处理完成"),
    OTHER("其他");

    private final String label;

    TicketCategory(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }

    public static TicketCategory fromString(String value) {
        if (value == null) return null;
        return valueOf(value);
    }
}
