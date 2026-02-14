package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.ticket.entity.Ticket;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class WeChatWorkNotifyService {

    private final SystemConfigService configService;
    private final RestTemplate restTemplate = new RestTemplate();

    @Async
    public void notifyAuditPass(Ticket ticket) {
        String content = String.format(
                "**工单审核通过** \uD83C\uDF89\n" +
                ">工单号: <font color=\"comment\">#%s</font>\n" +
                ">标题: %s\n" +
                ">审核结果: <font color=\"info\">通过</font>",
                ticket.getExternalId(), ticket.getSubject());
        sendMarkdown(content);
    }

    @Async
    public void notifyAuditReject(Ticket ticket, String remark) {
        String content = String.format(
                "**工单审核驳回** \u26A0\uFE0F\n" +
                ">工单号: <font color=\"comment\">#%s</font>\n" +
                ">标题: %s\n" +
                ">审核结果: <font color=\"warning\">驳回</font>\n" +
                ">驳回意见: %s\n" +
                ">后续: 已重新进入AI回复队列",
                ticket.getExternalId(), ticket.getSubject(),
                remark != null ? remark : "无");
        sendMarkdown(content);
    }

    @Async
    public void notifyReplyPushed(Ticket ticket) {
        String content = String.format(
                "**工单回复已推送** \u2705\n" +
                ">工单号: <font color=\"comment\">#%s</font>\n" +
                ">标题: %s\n" +
                ">状态: 已推送到Freshdesk",
                ticket.getExternalId(), ticket.getSubject());
        sendMarkdown(content);
    }

    @Async
    public void notifyMqReplyCompleted(Ticket ticket) {
        String content = String.format(
                "**AI回复生成完成** \uD83E\uDD16\n" +
                ">工单号: <font color=\"comment\">#%s</font>\n" +
                ">标题: %s\n" +
                ">状态: 等待审核",
                ticket.getExternalId(), ticket.getSubject());
        sendMarkdown(content);
    }

    /**
     * 发送测试消息（供前端测试连通性）
     */
    public boolean sendTestMessage() {
        return sendMarkdown("**FD-AutoPilot 通知测试** \uD83D\uDD14\n>企业微信通知配置成功！");
    }

    private boolean sendMarkdown(String content) {
        if (!configService.isWeComNotifyEnabled()) {
            return false;
        }

        String webhookUrl = configService.getWeComWebhookUrl();
        if (webhookUrl == null || webhookUrl.isBlank()) {
            log.warn("企业微信 Webhook URL 未配置，跳过通知");
            return false;
        }

        try {
            Map<String, Object> body = Map.of(
                    "msgtype", "markdown",
                    "markdown", Map.of("content", content)
            );

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    webhookUrl, HttpMethod.POST, entity, String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("企业微信通知发送成功");
                return true;
            } else {
                log.warn("企业微信通知发送失败: {}", response.getStatusCode());
                return false;
            }
        } catch (Exception e) {
            log.error("企业微信通知发送异常", e);
            return false;
        }
    }
}
