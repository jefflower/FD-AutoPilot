package com.jefflower.fdserver.ticket.enums;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * JPA 转换器：数据库字符串 ↔ TicketStatus 枚举。
 * <p>
 * 向后兼容旧状态值（TRANSLATING/PENDING_REPLY/REPLYING）→ PROCESSING。
 */
@Converter(autoApply = false)
public class TicketStatusConverter implements AttributeConverter<TicketStatus, String> {

    @Override
    public String convertToDatabaseColumn(TicketStatus attribute) {
        return attribute == null ? null : attribute.name();
    }

    @Override
    public TicketStatus convertToEntityAttribute(String dbData) {
        return TicketStatus.fromString(dbData);
    }
}
