package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.repository.WebhookEventRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Webhook 事件监控与管理端点。
 * 提供事件统计和手动清理功能，供管理后台使用。
 */
@Tag(name = "Webhook 事件管理", description = "Webhook 事件统计与清理")
@Slf4j
@RestController
@RequestMapping("/api/v1/webhooks/events")
@RequiredArgsConstructor
public class WebhookEventController {

    private final WebhookEventRepository webhookEventRepository;

    @Operation(summary = "获取 Webhook 事件统计", description = "返回事件总数、最近 24 小时数、已处理数和未处理数")
    @GetMapping("/stats")
    @RequiresPermission("config:read")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getEventStats() {
        long total = webhookEventRepository.count();
        long last24h = webhookEventRepository.countByReceivedAtAfter(LocalDateTime.now().minusHours(24));
        long processed = webhookEventRepository.countByProcessed(true);
        long unprocessed = webhookEventRepository.countByProcessed(false);

        Map<String, Object> stats = Map.of(
                "total", total,
                "last24h", last24h,
                "processed", processed,
                "unprocessed", unprocessed
        );
        return ResponseEntity.ok(ApiResponse.ok(stats));
    }

    @Operation(summary = "手动清理旧 Webhook 事件", description = "清理 7 天前的 Webhook 事件记录，需要 config:manage 权限")
    @PostMapping("/cleanup")
    @RequiresPermission("config:manage")
    @Transactional
    public ResponseEntity<ApiResponse<Map<String, Object>>> cleanupOldEvents() {
        long beforeCount = webhookEventRepository.count();
        LocalDateTime cutoff = LocalDateTime.now().minusDays(7);
        log.info("Manual webhook event cleanup triggered, cutoff: {}", cutoff);
        webhookEventRepository.deleteByReceivedAtBefore(cutoff);
        long afterCount = webhookEventRepository.count();
        long deletedCount = beforeCount - afterCount;
        log.info("Manual webhook event cleanup completed, deleted {} events", deletedCount);

        Map<String, Object> result = Map.of(
                "deletedCount", deletedCount,
                "remainingCount", afterCount,
                "cutoff", cutoff.toString()
        );
        return ResponseEntity.ok(ApiResponse.ok(result));
    }
}
