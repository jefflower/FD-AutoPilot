package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.ticket.entity.SystemConfig;
import com.jefflower.fdserver.ticket.repository.SystemConfigRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;


@Service
@RequiredArgsConstructor
public class SystemConfigService {

    private final SystemConfigRepository configRepository;

    public static final String KEY_AUTO_REPLY_ENABLED = "auto_reply_enabled";
    public static final String KEY_WECOM_WEBHOOK_URL = "wecom_webhook_url";
    public static final String KEY_WECOM_NOTIFY_ENABLED = "wecom_notify_enabled";
    public static final String KEY_NOTIFY_PLATFORM = "notify_platform";
    public static final String KEY_DINGTALK_WEBHOOK_URL = "dingtalk_webhook_url";
    public static final String KEY_DINGTALK_NOTIFY_ENABLED = "dingtalk_notify_enabled";
    public static final String KEY_AUDIT_BASE_URL = "audit_base_url";
    public static final String KEY_AUDIT_TOKEN_EXPIRE_HOURS = "audit_token_expire_hours";

    // ========== 自动推送配置 ==========

    public boolean isAutoReplyEnabled() {
        return getBooleanConfig(KEY_AUTO_REPLY_ENABLED, false);
    }

    public void setAutoReplyEnabled(boolean enabled) {
        setConfig(KEY_AUTO_REPLY_ENABLED, String.valueOf(enabled), "审核通过后自动推送Freshdesk");
    }

    public String getWeComWebhookUrl() {
        return getStringConfig(KEY_WECOM_WEBHOOK_URL, "");
    }

    public void setWeComWebhookUrl(String url) {
        setConfig(KEY_WECOM_WEBHOOK_URL, url, "企业微信Webhook地址");
    }

    public boolean isWeComNotifyEnabled() {
        return getBooleanConfig(KEY_WECOM_NOTIFY_ENABLED, false);
    }

    public void setWeComNotifyEnabled(boolean enabled) {
        setConfig(KEY_WECOM_NOTIFY_ENABLED, String.valueOf(enabled), "是否启用企业微信通知");
    }

    // ========== 通知平台配置 ==========

    public String getNotifyPlatform() {
        return getStringConfig(KEY_NOTIFY_PLATFORM, "wecom"); // 默认企业微信，向后兼容
    }

    public void setNotifyPlatform(String platform) {
        setConfig(KEY_NOTIFY_PLATFORM, platform, "通知平台: wecom/dingtalk/none");
    }

    public String getDingTalkWebhookUrl() {
        return getStringConfig(KEY_DINGTALK_WEBHOOK_URL, "");
    }

    public void setDingTalkWebhookUrl(String url) {
        setConfig(KEY_DINGTALK_WEBHOOK_URL, url, "钉钉Webhook地址");
    }

    public boolean isDingTalkNotifyEnabled() {
        return getBooleanConfig(KEY_DINGTALK_NOTIFY_ENABLED, false);
    }

    public void setDingTalkNotifyEnabled(boolean enabled) {
        setConfig(KEY_DINGTALK_NOTIFY_ENABLED, String.valueOf(enabled), "是否启用钉钉通知");
    }

    // ========== 审核链接配置 ==========

    public String getAuditBaseUrl() {
        return getStringConfig(KEY_AUDIT_BASE_URL, "");
    }

    public void setAuditBaseUrl(String url) {
        setConfig(KEY_AUDIT_BASE_URL, url, "移动审核链接域名");
    }

    public int getAuditTokenExpireHours() {
        return getIntConfig(KEY_AUDIT_TOKEN_EXPIRE_HOURS, 24); // 默认24小时
    }

    public void setAuditTokenExpireHours(int hours) {
        setConfig(KEY_AUDIT_TOKEN_EXPIRE_HOURS, String.valueOf(hours), "审核Token有效时长(小时)");
    }

    private boolean getBooleanConfig(String key, boolean defaultValue) {
        return configRepository.findById(key)
                .map(c -> "true".equalsIgnoreCase(c.getConfigValue()))
                .orElse(defaultValue);
    }

    private String getStringConfig(String key, String defaultValue) {
        return configRepository.findById(key)
                .map(SystemConfig::getConfigValue)
                .orElse(defaultValue);
    }

    private int getIntConfig(String key, int defaultValue) {
        return configRepository.findById(key)
                .map(c -> {
                    try { return Integer.parseInt(c.getConfigValue()); }
                    catch (NumberFormatException e) { return defaultValue; }
                })
                .orElse(defaultValue);
    }

    private void setConfig(String key, String value, String description) {
        SystemConfig config = configRepository.findById(key).orElseGet(() -> {
            SystemConfig c = new SystemConfig();
            c.setConfigKey(key);
            return c;
        });
        config.setConfigValue(value);
        config.setDescription(description);
        configRepository.save(config);
    }
}
