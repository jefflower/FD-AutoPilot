package com.jefflower.fdserver.service;

import com.jefflower.fdserver.entity.SystemConfig;
import com.jefflower.fdserver.repository.SystemConfigRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class SystemConfigService {

    private final SystemConfigRepository configRepository;

    public static final String KEY_AUTO_REPLY_ENABLED = "auto_reply_enabled";
    public static final String KEY_WECOM_WEBHOOK_URL = "wecom_webhook_url";
    public static final String KEY_WECOM_NOTIFY_ENABLED = "wecom_notify_enabled";

    // MQ 配置 keys
    public static final String KEY_MQ_QUEUE_TRANSLATION = "mq_queue_translation";
    public static final String KEY_MQ_QUEUE_REPLY = "mq_queue_reply";
    public static final String KEY_MQ_QUEUE_AUDIT = "mq_queue_audit";
    public static final String KEY_MQ_QUEUE_DLQ = "mq_queue_dlq";
    public static final String KEY_MQ_EXCHANGE = "mq_exchange";
    public static final String KEY_MQ_ROUTING_TRANSLATE = "mq_routing_translate";
    public static final String KEY_MQ_ROUTING_REPLY = "mq_routing_reply";
    public static final String KEY_MQ_ROUTING_AUDIT = "mq_routing_audit";

    // 默认值
    private static final String DEFAULT_QUEUE_TRANSLATION = "q.ticket.translation";
    private static final String DEFAULT_QUEUE_REPLY = "q.ticket.reply";
    private static final String DEFAULT_QUEUE_AUDIT = "q.ticket.audit";
    private static final String DEFAULT_QUEUE_DLQ = "q.ticket.dlq";
    private static final String DEFAULT_EXCHANGE = "fd.ticket.task.exchange";
    private static final String DEFAULT_ROUTING_TRANSLATE = "ticket.task.translate";
    private static final String DEFAULT_ROUTING_REPLY = "ticket.task.reply";
    private static final String DEFAULT_ROUTING_AUDIT = "ticket.task.audit";

    // ========== MQ 配置 Getters ==========

    public String getMqQueueTranslation() { return getStringConfig(KEY_MQ_QUEUE_TRANSLATION, DEFAULT_QUEUE_TRANSLATION); }
    public String getMqQueueReply() { return getStringConfig(KEY_MQ_QUEUE_REPLY, DEFAULT_QUEUE_REPLY); }
    public String getMqQueueAudit() { return getStringConfig(KEY_MQ_QUEUE_AUDIT, DEFAULT_QUEUE_AUDIT); }
    public String getMqQueueDlq() { return getStringConfig(KEY_MQ_QUEUE_DLQ, DEFAULT_QUEUE_DLQ); }
    public String getMqExchange() { return getStringConfig(KEY_MQ_EXCHANGE, DEFAULT_EXCHANGE); }
    public String getMqRoutingTranslate() { return getStringConfig(KEY_MQ_ROUTING_TRANSLATE, DEFAULT_ROUTING_TRANSLATE); }
    public String getMqRoutingReply() { return getStringConfig(KEY_MQ_ROUTING_REPLY, DEFAULT_ROUTING_REPLY); }
    public String getMqRoutingAudit() { return getStringConfig(KEY_MQ_ROUTING_AUDIT, DEFAULT_ROUTING_AUDIT); }

    // ========== MQ 配置 Setters ==========

    public void setMqQueueTranslation(String v) { setConfig(KEY_MQ_QUEUE_TRANSLATION, v, "翻译队列名"); }
    public void setMqQueueReply(String v) { setConfig(KEY_MQ_QUEUE_REPLY, v, "回复队列名"); }
    public void setMqQueueAudit(String v) { setConfig(KEY_MQ_QUEUE_AUDIT, v, "审核队列名"); }
    public void setMqQueueDlq(String v) { setConfig(KEY_MQ_QUEUE_DLQ, v, "死信队列名"); }
    public void setMqExchange(String v) { setConfig(KEY_MQ_EXCHANGE, v, "交换机名"); }
    public void setMqRoutingTranslate(String v) { setConfig(KEY_MQ_ROUTING_TRANSLATE, v, "翻译路由键"); }
    public void setMqRoutingReply(String v) { setConfig(KEY_MQ_ROUTING_REPLY, v, "回复路由键"); }
    public void setMqRoutingAudit(String v) { setConfig(KEY_MQ_ROUTING_AUDIT, v, "审核路由键"); }

    // ========== MQ 配置批量操作 ==========

    /**
     * 获取所有 MQ 配置（用于 API 端点返回）
     */
    public Map<String, String> getAllMqConfig() {
        Map<String, String> config = new LinkedHashMap<>();
        config.put("queueTranslation", getMqQueueTranslation());
        config.put("queueReply", getMqQueueReply());
        config.put("queueAudit", getMqQueueAudit());
        config.put("queueDlq", getMqQueueDlq());
        config.put("exchange", getMqExchange());
        config.put("routingTranslate", getMqRoutingTranslate());
        config.put("routingReply", getMqRoutingReply());
        config.put("routingAudit", getMqRoutingAudit());
        return config;
    }

    /**
     * 批量更新 MQ 配置
     */
    public void updateMqConfig(Map<String, String> config) {
        if (config.containsKey("queueTranslation")) setMqQueueTranslation(config.get("queueTranslation"));
        if (config.containsKey("queueReply")) setMqQueueReply(config.get("queueReply"));
        if (config.containsKey("queueAudit")) setMqQueueAudit(config.get("queueAudit"));
        if (config.containsKey("queueDlq")) setMqQueueDlq(config.get("queueDlq"));
        if (config.containsKey("exchange")) setMqExchange(config.get("exchange"));
        if (config.containsKey("routingTranslate")) setMqRoutingTranslate(config.get("routingTranslate"));
        if (config.containsKey("routingReply")) setMqRoutingReply(config.get("routingReply"));
        if (config.containsKey("routingAudit")) setMqRoutingAudit(config.get("routingAudit"));
    }

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
