package com.jefflower.fdserver.ticket.service.notify;

/**
 * 通知策略接口 -- 支持企业微信、钉钉等多平台
 */
public interface NotifyStrategy {
    /**
     * 发送 markdown 消息
     */
    boolean sendMarkdown(String webhookUrl, String content);

    /**
     * 发送带审核链接的通知（平台特定格式）
     */
    boolean sendAuditNotify(String webhookUrl, String title, String content, String auditUrl);

    /**
     * 发送测试消息
     * @return null 表示成功，非 null 返回错误描述
     */
    String sendTestMessage(String webhookUrl);

    /**
     * 平台标识
     */
    String getPlatformName();
}
