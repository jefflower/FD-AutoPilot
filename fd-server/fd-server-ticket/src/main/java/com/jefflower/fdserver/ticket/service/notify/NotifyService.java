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
        String content = String.format(
                "**工单审核通过**\n" +
                ">工单号: #%s\n" +
                ">标题: %s\n" +
                ">审核结果: 通过",
                ticket.getExternalId(), ticket.getSubject());
        sendWithActiveStrategy(s -> s.sendMarkdown(getWebhookUrl(), content));
    }

    /**
     * 通知：审核驳回
     */
    @Async
    public void notifyAuditReject(Ticket ticket, String remark) {
        String content = String.format(
                "**工单审核驳回**\n" +
                ">工单号: #%s\n" +
                ">标题: %s\n" +
                ">审核结果: 驳回\n" +
                ">驳回意见: %s\n" +
                ">后续: 已重新进入AI回复队列",
                ticket.getExternalId(), ticket.getSubject(),
                remark != null ? remark : "无");
        sendWithActiveStrategy(s -> s.sendMarkdown(getWebhookUrl(), content));
    }

    /**
     * 通知：回复已推送到 Freshdesk
     */
    @Async
    public void notifyReplyPushed(Ticket ticket) {
        String content = String.format(
                "**工单回复已推送**\n" +
                ">工单号: #%s\n" +
                ">标题: %s\n" +
                ">状态: 已推送到Freshdesk",
                ticket.getExternalId(), ticket.getSubject());
        sendWithActiveStrategy(s -> s.sendMarkdown(getWebhookUrl(), content));
    }

    /**
     * 通知：AI 回复生成完成，等待审核（旧版，无审核链接）
     */
    @Async
    public void notifyMqReplyCompleted(Ticket ticket) {
        String content = String.format(
                "**AI回复生成完成**\n" +
                ">工单号: #%s\n" +
                ">标题: %s\n" +
                ">状态: 等待审核",
                ticket.getExternalId(), ticket.getSubject());
        sendWithActiveStrategy(s -> s.sendMarkdown(getWebhookUrl(), content));
    }

    /**
     * 通知：待审核（带审核链接）
     * 使用 auditToken 构建一键审核链接，审核人可直接在移动端完成审核
     */
    @Async
    public void notifyPendingAudit(Ticket ticket, String auditToken) {
        String auditBaseUrl = configService.getAuditBaseUrl();
        String auditLink = (auditBaseUrl != null && !auditBaseUrl.isBlank() && auditToken != null)
                ? auditBaseUrl + "/mobile-audit?token=" + auditToken
                : null;

        StringBuilder sb = new StringBuilder();
        sb.append(String.format(
                "**AI回复已生成，等待审核**\n" +
                ">工单号: #%s\n" +
                ">标题: %s\n" +
                ">状态: 等待审核",
                ticket.getExternalId(), ticket.getSubject()));

        if (auditLink != null) {
            sb.append(String.format("\n>[点击审核](%s)", auditLink));
        }

        String content = sb.toString();
        sendWithActiveStrategy(s -> s.sendMarkdown(getWebhookUrl(), content));
    }

    /**
     * 发送测试消息（同步，返回结果）
     */
    public boolean sendTestMessage() {
        NotifyStrategy strategy = getActiveStrategy();
        if (strategy == null) {
            log.warn("[NotifyService] 无活跃通知策略");
            return false;
        }
        String webhookUrl = getWebhookUrl();
        if (webhookUrl == null || webhookUrl.isBlank()) {
            log.warn("[NotifyService] Webhook URL 未配置");
            return false;
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
