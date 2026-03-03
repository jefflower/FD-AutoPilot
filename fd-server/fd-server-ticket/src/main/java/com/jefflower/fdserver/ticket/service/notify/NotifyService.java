package com.jefflower.fdserver.ticket.service.notify;

import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.service.SystemConfigService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
public class NotifyService {

    private final SystemConfigService configService;
    private final Map<String, NotifyStrategy> strategies;

    public NotifyService(SystemConfigService configService, List<NotifyStrategy> strategyList) {
        this.configService = configService;
        this.strategies = strategyList.stream()
                .collect(Collectors.toMap(NotifyStrategy::getPlatformName, Function.identity()));
        log.info("[NotifyService] 已注册通知策略: {}", strategies.keySet());
    }

    /**
     * 通知：审核通过
     */
    @Async
    public void notifyAuditPass(Ticket ticket) {
        String lang = configService.getNotifyLanguage();
        String content = NotifyTemplate.auditPassBody(lang, ticket.getExternalId(), ticket.getSubject());
        sendWithActiveStrategy(s -> s.sendMarkdown(getWebhookUrl(), content));
    }

    /**
     * 通知：审核驳回
     */
    @Async
    public void notifyAuditReject(Ticket ticket, String remark) {
        String lang = configService.getNotifyLanguage();
        String content = NotifyTemplate.auditRejectBody(lang, ticket.getExternalId(), ticket.getSubject(), remark);
        sendWithActiveStrategy(s -> s.sendMarkdown(getWebhookUrl(), content));
    }

    /**
     * 通知：回复已推送到 Freshdesk
     */
    @Async
    public void notifyReplyPushed(Ticket ticket) {
        String lang = configService.getNotifyLanguage();
        String content = NotifyTemplate.replyPushedBody(lang, ticket.getExternalId(), ticket.getSubject());
        sendWithActiveStrategy(s -> s.sendMarkdown(getWebhookUrl(), content));
    }

    /**
     * 通知：AI 回复生成完成，等待审核（旧版，无审核链接）
     */
    @Async
    public void notifyMqReplyCompleted(Ticket ticket) {
        String lang = configService.getNotifyLanguage();
        String content = NotifyTemplate.mqReplyCompletedBody(lang, ticket.getExternalId(), ticket.getSubject());
        sendWithActiveStrategy(s -> s.sendMarkdown(getWebhookUrl(), content));
    }

    /**
     * 通知：待审核（带审核链接）
     * 使用 auditToken 构建一键审核链接，审核人可直接在移动端完成审核。
     * 有审核链接时使用 sendAuditNotify（钉钉: actionCard 带按钮），无链接时降级为 sendMarkdown。
     */
    @Async
    public void notifyPendingAudit(Ticket ticket, String auditToken) {
        String lang = configService.getNotifyLanguage();
        String auditBaseUrl = configService.getAuditBaseUrl();
        String auditLink = (auditBaseUrl != null && !auditBaseUrl.isBlank() && auditToken != null)
                ? auditBaseUrl + "/mobile-audit?token=" + auditToken
                : null;

        String title = NotifyTemplate.pendingAuditTitle(lang);
        String content = NotifyTemplate.pendingAuditBody(lang, ticket.getExternalId(), ticket.getSubject());

        if (auditLink != null) {
            sendWithActiveStrategy(s -> s.sendAuditNotify(getWebhookUrl(), title, content, auditLink));
        } else {
            sendWithActiveStrategy(s -> s.sendMarkdown(getWebhookUrl(), content));
        }
    }

    /**
     * 发送测试消息（同步，返回结果）
     * @return null 表示成功，非 null 返回错误描述
     */
    public String sendTestMessage() {
        NotifyStrategy strategy = getActiveStrategy();
        if (strategy == null) {
            log.warn("[NotifyService] 无活跃通知策略");
            return "无活跃通知策略，请先选择通知平台";
        }
        String webhookUrl = getWebhookUrl();
        if (webhookUrl == null || webhookUrl.isBlank()) {
            log.warn("[NotifyService] Webhook URL 未配置");
            return "Webhook URL 未配置";
        }
        return strategy.sendTestMessage(webhookUrl);
    }

    // ========== 内部方法 ==========

    private NotifyStrategy getActiveStrategy() {
        String platform = configService.getNotifyPlatform();
        if ("none".equals(platform)) return null;
        NotifyStrategy strategy = strategies.get(platform);
        if (strategy == null) {
            log.warn("[NotifyService] 未找到通知策略: {}, 可用策略: {}", platform, strategies.keySet());
        }
        return strategy;
    }

    private String getWebhookUrl() {
        String platform = configService.getNotifyPlatform();
        return switch (platform) {
            case "wecom" -> configService.getWeComWebhookUrl();
            case "dingtalk" -> configService.getDingTalkWebhookUrl();
            default -> "";
        };
    }

    private void sendWithActiveStrategy(Function<NotifyStrategy, Boolean> action) {
        NotifyStrategy strategy = getActiveStrategy();
        if (strategy == null) return;
        String webhookUrl = getWebhookUrl();
        if (webhookUrl == null || webhookUrl.isBlank()) {
            log.warn("[NotifyService] {} Webhook URL 未配置，跳过通知", strategy.getPlatformName());
            return;
        }
        try {
            action.apply(strategy);
        } catch (Exception e) {
            log.error("[NotifyService] 通知发送异常", e);
        }
    }
}
