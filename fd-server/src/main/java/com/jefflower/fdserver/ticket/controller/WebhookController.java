package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.ticket.client.FreshdeskApiClient;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.service.FreshdeskSyncService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Freshdesk Webhook 接收端点
 *
 * Freshdesk Automation Rule 配置：
 * - URL: https://your-server:9988/api/v1/webhook/freshdesk
 * - Method: POST
 * - Body: { "ticket_id": "{{ticket.id}}", "event": "ticket_created" }
 * - Custom Header: X-Freshdesk-Webhook-Secret: <your-secret>
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/webhook")
@RequiredArgsConstructor
public class WebhookController {

    private final FreshdeskSyncService syncService;
    private final FreshdeskApiClient apiClient;

    @Value("${freshdesk.webhook.secret:}")
    private String webhookSecret;

    @PostMapping("/freshdesk")
    public ResponseEntity<Map<String, String>> handleFreshdeskWebhook(
            @RequestBody Map<String, Object> payload,
            @RequestHeader(value = "X-Freshdesk-Webhook-Secret", required = false) String secret,
            HttpServletRequest request) {

        // 验签（如果配置了 secret）
        if (!verifyWebhookSecret(secret)) {
            log.warn("Webhook request rejected: invalid secret from {}", request.getRemoteAddr());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid webhook secret"));
        }

        String ticketId = extractTicketId(payload);
        if (ticketId == null) {
            log.warn("Webhook payload missing ticket_id: {}", payload);
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing ticket_id"));
        }

        String event = payload.get("event") != null ? String.valueOf(payload.get("event")) : "unknown";
        log.info("Received Freshdesk webhook: event={}, ticket_id={}", event, ticketId);

        // 异步处理，快速返回 200 给 Freshdesk
        final String tid = ticketId;
        CompletableFuture.runAsync(() -> {
            try {
                processSingleTicketFromWebhook(tid);
            } catch (Exception e) {
                log.error("Failed to process webhook for ticket #{}", tid, e);
            }
        });

        return ResponseEntity.ok(Map.of("status", "accepted"));
    }

    private void processSingleTicketFromWebhook(String ticketId) {
        Map<String, Object> fdTicket = apiClient.fetchSingleTicket(ticketId);
        if (fdTicket == null) {
            log.error("Failed to fetch ticket #{} from Freshdesk API", ticketId);
            return;
        }

        syncService.processSingleTicketFromWebhook(fdTicket);
        log.info("Webhook processing completed for ticket #{}", ticketId);
    }

    private boolean verifyWebhookSecret(String receivedSecret) {
        if (webhookSecret == null || webhookSecret.isEmpty()) {
            return true; // 未配置密钥时跳过验证（开发环境）
        }
        return webhookSecret.equals(receivedSecret);
    }

    private String extractTicketId(Map<String, Object> payload) {
        // Freshdesk webhook 主格式
        Object ticketId = payload.get("ticket_id");
        if (ticketId != null) {
            return String.valueOf(ticketId);
        }

        // 兼容嵌套格式 { "freshdesk_webhook": { "ticket_id": "..." } }
        Object nested = payload.get("freshdesk_webhook");
        if (nested instanceof Map<?, ?> nestedMap) {
            Object nestedId = nestedMap.get("ticket_id");
            if (nestedId != null) {
                return String.valueOf(nestedId);
            }
        }

        return null;
    }
}
