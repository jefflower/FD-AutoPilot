package com.jefflower.fdserver.ticket.dto;

import lombok.Data;

@Data
public class NotifyChannelConfig {
    private String platform;      // "wecom" / "dingtalk" / "none"
    private String webhookUrl;
    private boolean enabled;
    private String auditBaseUrl;  // 审核链接的 baseUrl
}
