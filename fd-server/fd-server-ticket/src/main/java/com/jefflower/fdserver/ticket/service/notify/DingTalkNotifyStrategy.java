package com.jefflower.fdserver.ticket.service.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ticket.service.SystemConfigService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@Slf4j
@Component("dingtalk")
@RequiredArgsConstructor
public class DingTalkNotifyStrategy implements NotifyStrategy {

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final SystemConfigService configService;

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
        String lang = configService.getNotifyLanguage();
        // 钉钉使用 actionCard 消息类型，带审核按钮
        return doSend(webhookUrl, Map.of(
                "msgtype", "actionCard",
                "actionCard", Map.of(
                        "title", title,
                        "text", content,
                        "singleTitle", NotifyTemplate.auditButtonText(lang),
                        "singleURL", auditUrl
                )
        ));
    }

    @Override
    public String sendTestMessage(String webhookUrl) {
        String lang = configService.getNotifyLanguage();
        String content = NotifyTemplate.testBodyDingTalk(lang);
        String title = extractTitle(content);
        return doSendWithDetail(webhookUrl, Map.of(
                "msgtype", "markdown",
                "markdown", Map.of("title", title, "text", content)
        ));
    }

    private String extractTitle(String content) {
        // 从 markdown 内容提取第一行作为 title（去掉 markdown 标记）
        String firstLine = content.split("\n")[0];
        return firstLine.replaceAll("[*#>]", "").trim();
    }

    private boolean doSend(String webhookUrl, Map<String, Object> body) {
        return doSendWithDetail(webhookUrl, body) == null;
    }

    /**
     * @return null 表示成功，非 null 返回错误描述
     */
    private String doSendWithDetail(String webhookUrl, Map<String, Object> body) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
            ResponseEntity<String> response = restTemplate.exchange(
                    webhookUrl, HttpMethod.POST, entity, String.class);
            if (!response.getStatusCode().is2xxSuccessful()) {
                String msg = "HTTP " + response.getStatusCode();
                log.warn("[DingTalk] 通知发送失败, {}", msg);
                return msg;
            }
            // 钉钉 API 即使失败也返回 HTTP 200，需要检查响应体中的 errcode
            String responseBody = response.getBody();
            if (responseBody != null) {
                JsonNode json = objectMapper.readTree(responseBody);
                int errcode = json.path("errcode").asInt(-1);
                if (errcode != 0) {
                    String errmsg = json.path("errmsg").asText("unknown");
                    log.warn("[DingTalk] 通知发送失败, errcode={}, errmsg={}", errcode, errmsg);
                    return errmsg;
                }
            }
            log.info("[DingTalk] 通知发送成功");
            return null;
        } catch (Exception e) {
            log.error("[DingTalk] 通知发送异常", e);
            return e.getMessage();
        }
    }
}
