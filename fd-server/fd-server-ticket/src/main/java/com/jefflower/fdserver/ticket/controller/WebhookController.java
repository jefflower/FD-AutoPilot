package com.jefflower.fdserver.ticket.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ticket.client.FreshdeskApiClient;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.service.FreshdeskSyncService;
import com.jefflower.fdserver.ticket.service.WebhookDeduplicationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
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
@Tag(name = "Webhook", description = "Freshdesk Webhook 回调接收端点（无需认证）")
@Slf4j
@RestController
@RequestMapping("/api/v1/webhook")
@RequiredArgsConstructor
public class WebhookController {

    private final FreshdeskSyncService syncService;
    private final FreshdeskApiClient apiClient;
    private final WebhookDeduplicationService deduplicationService;
    private final ObjectMapper objectMapper;

    @Value("${freshdesk.webhook.secret:}")
    private String webhookSecret;

    @Operation(summary = "接收 Freshdesk Webhook", description = "接收 Freshdesk 工单事件回调，异步处理单条工单同步。需要通过 X-Freshdesk-Webhook-Secret 头验证签名。支持幂等性去重。")
    @PostMapping("/freshdesk")
    public ResponseEntity<Map<String, String>> handleFreshdeskWebhook(
            @RequestBody String rawBody,
            @Parameter(description = "Webhook 密钥验证") @RequestHeader(value = "X-Freshdesk-Webhook-Secret", required = false) String secret,
            HttpServletRequest request) {

        // 验签（如果配置了 secret）
        if (!verifyWebhookSecret(secret)) {
            log.warn("Webhook request rejected: invalid secret from {}", request.getRemoteAddr());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid webhook secret"));
        }

        // 解析 JSON body
        Map<String, Object> payload;
        try {
            payload = objectMapper.readValue(rawBody, new TypeReference<>() {});
        } catch (Exception e) {
            log.warn("Webhook payload parse error: {}", e.getMessage());
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Invalid JSON payload"));
        }

        String ticketId = extractTicketId(payload);
        if (ticketId == null) {
            log.warn("Webhook payload missing ticket_id: {}", payload);
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing ticket_id"));
        }

        String event = payload.get("event") != null ? String.valueOf(payload.get("event")) : "unknown";

        // 幂等性去重：对 raw body 计算 SHA-256 hash 作为 eventId
        String eventId = generateEventId(rawBody);
        if (deduplicationService.isDuplicate(eventId, event, ticketId)) {
            log.info("Duplicate webhook ignored: eventId={}, event={}, ticket_id={}", eventId, event, ticketId);
            return ResponseEntity.ok(Map.of("status", "duplicate_ignored"));
        }

        log.info("Received Freshdesk webhook: event={}, ticket_id={}, eventId={}", event, ticketId, eventId);

        // 异步处理，快速返回 200 给 Freshdesk
        final String tid = ticketId;
        CompletableFuture.runAsync(() -> {
            try {
                processSingleTicketFromWebhook(tid);
                deduplicationService.markProcessed(eventId);
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
            log.warn("Webhook secret not configured — skipping verification. Set FRESHDESK_WEBHOOK_SECRET for production.");
            return true; // 未配置密钥时跳过验证（开发环境）
        }
        if (receivedSecret == null) {
            return false;
        }
        // 常量时间比较，防止时序攻击
        return MessageDigest.isEqual(
                webhookSecret.getBytes(StandardCharsets.UTF_8),
                receivedSecret.getBytes(StandardCharsets.UTF_8));
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

    /**
     * 对 Webhook 请求 raw body 计算 SHA-256 hash，生成事件唯一 ID。
     * 格式：webhook:{hex-encoded-sha256}
     */
    private String generateEventId(String rawBody) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(rawBody.getBytes(StandardCharsets.UTF_8));
            return "webhook:" + HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is guaranteed to be available in every JVM
            throw new RuntimeException("SHA-256 algorithm not available", e);
        }
    }
}
