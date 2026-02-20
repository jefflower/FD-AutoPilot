package com.jefflower.fdserver.ticket.service.notify;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@Slf4j
@Component("dingtalk")
public class DingTalkNotifyStrategy implements NotifyStrategy {

    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String getPlatformName() {
        return "dingtalk";
    }

    @Override
    public boolean sendMarkdown(String webhookUrl, String content) {
        // 钉钉 markdown 需要 title 字段，从 content 第一行提取
        String title = extractTitle(content);
        return doSend(webhookUrl, Map.of(
                "msgtype", "markdown",
                "markdown", Map.of("title", title, "text", content)
        ));
    }

    @Override
    public boolean sendAuditNotify(String webhookUrl, String title, String content, String auditUrl) {
        // 钉钉使用 actionCard 消息类型，带"去审核"按钮
        return doSend(webhookUrl, Map.of(
                "msgtype", "actionCard",
                "actionCard", Map.of(
                        "title", title,
                        "text", content,
                        "singleTitle", "去审核",
                        "singleURL", auditUrl
                )
        ));
    }

    @Override
    public boolean sendTestMessage(String webhookUrl) {
        return sendMarkdown(webhookUrl, "### FD-AutoPilot 通知测试\n\n通知配置成功!\n\n平台: 钉钉");
    }

    private String extractTitle(String content) {
        // 从 markdown 内容提取第一行作为 title（去掉 markdown 标记）
        String firstLine = content.split("\n")[0];
        return firstLine.replaceAll("[*#>]", "").trim();
    }

    private boolean doSend(String webhookUrl, Map<String, Object> body) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
            ResponseEntity<String> response = restTemplate.exchange(
                    webhookUrl, HttpMethod.POST, entity, String.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("[DingTalk] 通知发送成功");
                return true;
            } else {
                log.warn("[DingTalk] 通知发送失败: {}", response.getStatusCode());
                return false;
            }
        } catch (Exception e) {
            log.error("[DingTalk] 通知发送异常", e);
            return false;
        }
    }
}
