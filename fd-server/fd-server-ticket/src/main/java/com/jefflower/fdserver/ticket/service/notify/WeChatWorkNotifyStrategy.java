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
@Component("wecom")
@RequiredArgsConstructor
public class WeChatWorkNotifyStrategy implements NotifyStrategy {

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final SystemConfigService configService;

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
        String lang = configService.getNotifyLanguage();
        String fullContent = content + "\n>\n>[" + NotifyTemplate.auditLinkText(lang) + "](" + auditUrl + ")";
        return sendMarkdown(webhookUrl, fullContent);
    }

    @Override
    public String sendTestMessage(String webhookUrl) {
        String lang = configService.getNotifyLanguage();
        return doSendWithDetail(webhookUrl, Map.of(
                "msgtype", "markdown",
                "markdown", Map.of("content", NotifyTemplate.testBodyWeCom(lang))
        ));
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
                log.warn("[WeCom] 通知发送失败, {}", msg);
                return msg;
            }
            // 企业微信 API 即使失败也返回 HTTP 200，需要检查响应体中的 errcode
            String responseBody = response.getBody();
            if (responseBody != null) {
                JsonNode json = objectMapper.readTree(responseBody);
                int errcode = json.path("errcode").asInt(-1);
                if (errcode != 0) {
                    String errmsg = json.path("errmsg").asText("unknown");
                    log.warn("[WeCom] 通知发送失败, errcode={}, errmsg={}", errcode, errmsg);
                    return errmsg;
                }
            }
            log.info("[WeCom] 通知发送成功");
            return null;
        } catch (Exception e) {
            log.error("[WeCom] 通知发送异常", e);
            return e.getMessage();
        }
    }
}
