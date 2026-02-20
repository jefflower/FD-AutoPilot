package com.jefflower.fdserver.ticket.service.notify;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@Slf4j
@Component("wecom")
public class WeChatWorkNotifyStrategy implements NotifyStrategy {

    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String getPlatformName() {
        return "wecom";
    }

    @Override
    public boolean sendMarkdown(String webhookUrl, String content) {
        return doSend(webhookUrl, Map.of(
                "msgtype", "markdown",
                "markdown", Map.of("content", content)
        ));
    }

    @Override
    public boolean sendAuditNotify(String webhookUrl, String title, String content, String auditUrl) {
        String fullContent = content + "\n>\n>[点击审核](" + auditUrl + ")";
        return sendMarkdown(webhookUrl, fullContent);
    }

    @Override
    public boolean sendTestMessage(String webhookUrl) {
        return sendMarkdown(webhookUrl, "**FD-AutoPilot 通知测试**\n>通知配置成功!\n>平台: 企业微信");
    }

    private boolean doSend(String webhookUrl, Map<String, Object> body) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
            ResponseEntity<String> response = restTemplate.exchange(
                    webhookUrl, HttpMethod.POST, entity, String.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("[WeCom] 通知发送成功");
                return true;
            } else {
                log.warn("[WeCom] 通知发送失败: {}", response.getStatusCode());
                return false;
            }
        } catch (Exception e) {
            log.error("[WeCom] 通知发送异常", e);
            return false;
        }
    }
}
