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
    public static final String KEY_N8N_WEBHOOK_URL = "n8n_webhook_url";
    public static final String KEY_N8N_WEBHOOK_ENABLED = "n8n_webhook_enabled";
    public static final String KEY_NOTEBOOKLM_DEFAULT_NOTEBOOK_ID = "notebooklm_default_notebook_id";
    public static final String KEY_NOTEBOOKLM_NOTEBOOK_MAPPING = "notebooklm_notebook_mapping";
    public static final String KEY_NOTIFY_LANGUAGE = "notify_language";
    public static final String KEY_KNOWLEDGE_SYNC_CONFIG = "knowledge_sync_config";
    public static final String KEY_FRESHDESK_DOMAIN = "freshdesk_domain";
    public static final String KEY_FRESHDESK_API_KEY = "freshdesk_api_key";

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

    // ========== n8n Webhook 配置 ==========

    public String getN8nWebhookUrl() {
        return getStringConfig(KEY_N8N_WEBHOOK_URL, "");
    }

    public void setN8nWebhookUrl(String url) {
        setConfig(KEY_N8N_WEBHOOK_URL, url, "n8n 工作流 Webhook URL（新工单同步后触发）");
    }

    public boolean isN8nWebhookEnabled() {
        return getBooleanConfig(KEY_N8N_WEBHOOK_ENABLED, false);
    }

    public void setN8nWebhookEnabled(boolean enabled) {
        setConfig(KEY_N8N_WEBHOOK_ENABLED, String.valueOf(enabled), "是否启用 n8n Webhook 通知");
    }

    // ========== 通知语言配置 ==========

    public String getNotifyLanguage() {
        return getStringConfig(KEY_NOTIFY_LANGUAGE, "zh-CN");
    }

    public void setNotifyLanguage(String lang) {
        setConfig(KEY_NOTIFY_LANGUAGE, lang, "通知语言: zh-CN/en-US");
    }

    // ========== NotebookLM 知识库配置 ==========

    public String getNotebookLmDefaultNotebookId() {
        return getStringConfig(KEY_NOTEBOOKLM_DEFAULT_NOTEBOOK_ID, "");
    }

    public void setNotebookLmDefaultNotebookId(String notebookId) {
        setConfig(KEY_NOTEBOOKLM_DEFAULT_NOTEBOOK_ID, notebookId, "NotebookLM 默认知识库 ID");
    }

    /**
     * 获取 NotebookLM 知识库映射（JSON：标签/类型 → NotebookID）
     * 格式示例: {"物流": "abc-123", "退款": "def-456", "技术": "ghi-789"}
     */
    public String getNotebookLmNotebookMapping() {
        return getStringConfig(KEY_NOTEBOOKLM_NOTEBOOK_MAPPING, "{}");
    }

    public void setNotebookLmNotebookMapping(String mappingJson) {
        setConfig(KEY_NOTEBOOKLM_NOTEBOOK_MAPPING, mappingJson, "NotebookLM 知识库映射（标签→NotebookID）");
    }

    /**
     * 根据工单标签匹配 NotebookID。
     * 优先匹配 mapping 中的标签，匹配不到则使用默认值。
     *
     * @param tags 工单标签列表
     * @return 匹配到的 NotebookID（可能为空字符串）
     */
    public String resolveNotebookId(java.util.List<String> tags) {
        String defaultId = getNotebookLmDefaultNotebookId();
        if (tags == null || tags.isEmpty()) {
            return defaultId;
        }

        String mappingJson = getNotebookLmNotebookMapping();
        if (mappingJson == null || mappingJson.equals("{}") || mappingJson.isBlank()) {
            return defaultId;
        }

        try {
            @SuppressWarnings("unchecked")
            java.util.Map<String, String> mapping = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(mappingJson, java.util.Map.class);

            for (String tag : tags) {
                String notebookId = mapping.get(tag);
                if (notebookId != null && !notebookId.isBlank()) {
                    return notebookId;
                }
            }
        } catch (Exception e) {
            // JSON 解析失败，使用默认值
        }

        return defaultId;
    }

    // ========== 知识库同步配置 ==========

    /**
     * 获取知识库同步配置
     * JSON 格式: {"knowledgeBaseId":1,"ticketSourceId":5,"notesSourceId":6}
     */
    public String getKnowledgeSyncConfig() {
        return getStringConfig(KEY_KNOWLEDGE_SYNC_CONFIG, "{}");
    }

    public void setKnowledgeSyncConfig(String configJson) {
        setConfig(KEY_KNOWLEDGE_SYNC_CONFIG, configJson, "知识库同步映射配置（工单/注意事项→源文件）");
    }

    // ========== Freshdesk 连接配置 ==========

    public String getFreshdeskDomain() {
        return getStringConfig(KEY_FRESHDESK_DOMAIN, "");
    }

    public void setFreshdeskDomain(String domain) {
        setConfig(KEY_FRESHDESK_DOMAIN, domain, "Freshdesk 域名（如 xxx.freshdesk.com）");
    }

    public String getFreshdeskApiKey() {
        return getStringConfig(KEY_FRESHDESK_API_KEY, "");
    }

    public void setFreshdeskApiKey(String apiKey) {
        setConfig(KEY_FRESHDESK_API_KEY, apiKey, "Freshdesk API Key");
    }

    /**
     * 检查 Freshdesk 是否已配置（domain 和 apiKey 都不为空）
     */
    public boolean isFreshdeskConfigured() {
        String domain = getFreshdeskDomain();
        String apiKey = getFreshdeskApiKey();
        return domain != null && !domain.isBlank() && apiKey != null && !apiKey.isBlank();
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
