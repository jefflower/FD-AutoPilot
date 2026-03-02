package com.jefflower.fdserver.ticket.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * n8n Webhook 通知器
 * <p>
 * 当 Freshdesk 同步新工单后，向 n8n Webhook URL 发送 POST 请求，
 * 触发 n8n 工作流实时处理新工单。
 */
@Slf4j
@Service
public class N8nWebhookNotifier {

    private final SystemConfigService configService;
    private final RestTemplate restTemplate = new RestTemplate();

    public N8nWebhookNotifier(SystemConfigService configService) {
        this.configService = configService;
    }

    /**
     * 异步通知 n8n 有新工单需要处理
     *
     * @param ticketIds 新工单 ID 列表
     */
    @Async
    public void notifyNewTickets(List<Long> ticketIds) {
        if (!configService.isN8nWebhookEnabled()) {
            return;
        }

        String webhookUrl = configService.getN8nWebhookUrl();
        if (webhookUrl == null || webhookUrl.isBlank()) {
            log.debug("[N8nWebhookNotifier] Webhook URL 未配置，跳过通知");
            return;
        }

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String, Object> body = Map.of(
                    "event", "new_tickets",
                    "ticketIds", ticketIds,
                    "count", ticketIds.size()
            );

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
            ResponseEntity<String> response = restTemplate.exchange(
                    webhookUrl, HttpMethod.POST, entity, String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("[N8nWebhookNotifier] 通知 n8n 成功: {} 个新工单", ticketIds.size());
            } else {
                log.warn("[N8nWebhookNotifier] 通知 n8n 返回非 200: status={}", response.getStatusCode());
            }
        } catch (Exception e) {
            log.error("[N8nWebhookNotifier] 通知 n8n 失败: {}", e.getMessage());
        }
    }
}
