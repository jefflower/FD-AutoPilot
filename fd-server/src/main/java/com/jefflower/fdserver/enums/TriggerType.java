package com.jefflower.fdserver.enums;

/**
 * 触发类型枚举
 */
public enum TriggerType {
    MANUAL, // 手动触发
    SCHEDULED, // 定时触发
    WEBHOOK // Freshdesk Webhook 触发
}
