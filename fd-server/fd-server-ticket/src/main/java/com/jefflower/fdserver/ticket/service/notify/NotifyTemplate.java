package com.jefflower.fdserver.ticket.service.notify;

/**
 * 通知消息模板 -- 支持 zh-CN / en-US 多语言
 * <p>
 * 所有文案统一在此管理，各 NotifyStrategy 实现类通过此类获取模板化内容。
 */
public final class NotifyTemplate {

    private NotifyTemplate() {}

    private static final String ZH_CN = "zh-CN";

    private static boolean isEnglish(String lang) {
        return "en-US".equalsIgnoreCase(lang) || "en".equalsIgnoreCase(lang);
    }

    // ===================== 审核待办通知 =====================

    public static String pendingAuditTitle(String lang) {
        return isEnglish(lang)
                ? "AI Reply Generated, Pending Audit"
                : "AI回复已生成，等待审核";
    }

    public static String pendingAuditBody(String lang, String externalId, String subject) {
        if (isEnglish(lang)) {
            return String.format(
                    "**%s**\n" +
                    ">Ticket: #%s\n" +
                    ">Subject: %s\n" +
                    ">Status: Pending Audit",
                    pendingAuditTitle(lang), externalId, subject);
        }
        return String.format(
                "**%s**\n" +
                ">工单号: #%s\n" +
                ">标题: %s\n" +
                ">状态: 等待审核",
                pendingAuditTitle(lang), externalId, subject);
    }

    // ===================== 审核通过通知 =====================

    public static String auditPassTitle(String lang) {
        return isEnglish(lang) ? "Ticket Audit Approved" : "工单审核通过";
    }

    public static String auditPassBody(String lang, String externalId, String subject) {
        if (isEnglish(lang)) {
            return String.format(
                    "**%s**\n" +
                    ">Ticket: #%s\n" +
                    ">Subject: %s\n" +
                    ">Result: Approved",
                    auditPassTitle(lang), externalId, subject);
        }
        return String.format(
                "**%s**\n" +
                ">工单号: #%s\n" +
                ">标题: %s\n" +
                ">审核结果: 通过",
                auditPassTitle(lang), externalId, subject);
    }

    // ===================== 审核驳回通知 =====================

    public static String auditRejectTitle(String lang) {
        return isEnglish(lang) ? "Ticket Audit Rejected" : "工单审核驳回";
    }

    public static String auditRejectBody(String lang, String externalId, String subject, String remark) {
        String safeRemark = (remark != null) ? remark : (isEnglish(lang) ? "N/A" : "无");
        if (isEnglish(lang)) {
            return String.format(
                    "**%s**\n" +
                    ">Ticket: #%s\n" +
                    ">Subject: %s\n" +
                    ">Result: Rejected\n" +
                    ">Reason: %s\n" +
                    ">Next: Re-queued for AI reply",
                    auditRejectTitle(lang), externalId, subject, safeRemark);
        }
        return String.format(
                "**%s**\n" +
                ">工单号: #%s\n" +
                ">标题: %s\n" +
                ">审核结果: 驳回\n" +
                ">驳回意见: %s\n" +
                ">后续: 已重新进入AI回复队列",
                auditRejectTitle(lang), externalId, subject, safeRemark);
    }

    // ===================== 回复已推送通知 =====================

    public static String replyPushedTitle(String lang) {
        return isEnglish(lang) ? "Ticket Reply Pushed" : "工单回复已推送";
    }

    public static String replyPushedBody(String lang, String externalId, String subject) {
        if (isEnglish(lang)) {
            return String.format(
                    "**%s**\n" +
                    ">Ticket: #%s\n" +
                    ">Subject: %s\n" +
                    ">Status: Pushed to Freshdesk",
                    replyPushedTitle(lang), externalId, subject);
        }
        return String.format(
                "**%s**\n" +
                ">工单号: #%s\n" +
                ">标题: %s\n" +
                ">状态: 已推送到Freshdesk",
                replyPushedTitle(lang), externalId, subject);
    }

    // ===================== AI 回复完成通知（旧版，无审核链接） =====================

    public static String mqReplyCompletedTitle(String lang) {
        return isEnglish(lang) ? "AI Reply Generated" : "AI回复生成完成";
    }

    public static String mqReplyCompletedBody(String lang, String externalId, String subject) {
        if (isEnglish(lang)) {
            return String.format(
                    "**%s**\n" +
                    ">Ticket: #%s\n" +
                    ">Subject: %s\n" +
                    ">Status: Pending Audit",
                    mqReplyCompletedTitle(lang), externalId, subject);
        }
        return String.format(
                "**%s**\n" +
                ">工单号: #%s\n" +
                ">标题: %s\n" +
                ">状态: 等待审核",
                mqReplyCompletedTitle(lang), externalId, subject);
    }

    // ===================== 测试通知 =====================

    public static String testTitle(String lang) {
        return isEnglish(lang) ? "FD-AutoPilot Notification Test" : "FD-AutoPilot 通知测试";
    }

    /**
     * 测试通知内容（钉钉 markdown 格式）
     */
    public static String testBodyDingTalk(String lang) {
        if (isEnglish(lang)) {
            return "### FD-AutoPilot Notification Test\n\nNotification configured successfully!\n\nPlatform: DingTalk";
        }
        return "### FD-AutoPilot 通知测试\n\n通知配置成功!\n\n平台: 钉钉";
    }

    /**
     * 测试通知内容（企业微信 markdown 格式）
     */
    public static String testBodyWeCom(String lang) {
        if (isEnglish(lang)) {
            return "**FD-AutoPilot Notification Test**\n>Notification configured successfully!\n>Platform: WeCom";
        }
        return "**FD-AutoPilot 通知测试**\n>通知配置成功!\n>平台: 企业微信";
    }

    // ===================== 审核按钮文案 =====================

    public static String auditButtonText(String lang) {
        return isEnglish(lang) ? "Go to Audit" : "去审核";
    }

    /**
     * 企业微信审核链接文案
     */
    public static String auditLinkText(String lang) {
        return isEnglish(lang) ? "Click to Audit" : "点击审核";
    }
}
