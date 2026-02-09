package com.jefflower.fdserver.service;

import com.jefflower.fdserver.entity.SystemConfig;
import com.jefflower.fdserver.repository.SystemConfigRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class SystemConfigService {

    private final SystemConfigRepository configRepository;

    public static final String KEY_AUTO_REPLY_ENABLED = "auto_reply_enabled";
    public static final String KEY_WECOM_WEBHOOK_URL = "wecom_webhook_url";
    public static final String KEY_WECOM_NOTIFY_ENABLED = "wecom_notify_enabled";

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
