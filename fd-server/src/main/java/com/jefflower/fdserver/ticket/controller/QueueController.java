package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.common.util.SuperPasswordVerifier;
import com.jefflower.fdserver.ticket.service.DlqConsumerService;
import com.jefflower.fdserver.ticket.service.SystemConfigService;
import com.jefflower.fdserver.ticket.service.TicketService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
public class QueueController {

    private final DlqConsumerService dlqConsumerService;
    private final RabbitAdmin rabbitAdmin;
    private final SystemConfigService systemConfigService;
    private final TicketService ticketService;

    @Value("${app.super-password:hnlx}")
    private String superPassword;

    /**
     * 清空所有 MQ 队列并回退处理中的工单状态（需超级密码验证）
     */
    @PostMapping("/queues/purge")
    @RequiresPermission("queue:manage")
    public ResponseEntity<ApiResponse<Map<String, Object>>> purgeQueues(
            @RequestBody Map<String, String> request) {
        String password = request.get("superPassword");
        if (!SuperPasswordVerifier.verify(password, superPassword)) {
            return ResponseEntity.status(403)
                    .body(ApiResponse.error("FORBIDDEN", "超级密码验证失败"));
        }

        int purgedMessages = 0;
        String[] queues = {
                systemConfigService.getMqQueueTranslation(),
                systemConfigService.getMqQueueReply(),
                systemConfigService.getMqQueueAudit(),
                systemConfigService.getMqQueueDlq()
        };
        for (String queue : queues) {
            try {
                int count = rabbitAdmin.purgeQueue(queue);
                purgedMessages += count;
                log.info("清空队列 {} : {} 条消息", queue, count);
            } catch (Exception e) {
                log.warn("清空队列 {} 失败: {}", queue, e.getMessage());
            }
        }

        int resetTickets = ticketService.resetProcessingTickets();

        Map<String, Object> data = new HashMap<>();
        data.put("purgedMessages", purgedMessages);
        data.put("resetTickets", resetTickets);
        log.info("队列重置完成：清空 {} 条消息，回退 {} 个工单", purgedMessages, resetTickets);

        return ResponseEntity.ok(ApiResponse.ok("队列重置完成", data));
    }

    /**
     * 一键清理：删除所有工单及关联数据（需超级密码验证）
     */
    @PostMapping("/tickets/purge-all")
    @RequiresPermission("queue:manage")
    public ResponseEntity<ApiResponse<Map<String, Object>>> purgeAllTickets(
            @RequestBody Map<String, String> request) {
        String password = request.get("superPassword");
        if (!SuperPasswordVerifier.verify(password, superPassword)) {
            return ResponseEntity.status(403)
                    .body(ApiResponse.error("FORBIDDEN", "超级密码验证失败"));
        }

        long deletedCount = ticketService.purgeAllTickets();

        Map<String, Object> data = new HashMap<>();
        data.put("deletedTickets", deletedCount);
        log.info("数据清理完成：删除了 {} 个工单及所有关联数据", deletedCount);

        return ResponseEntity.ok(ApiResponse.ok("数据清理完成", data));
    }

    /**
     * 手动将死信队列中的消息重新投递到指定队列
     */
    @PostMapping("/dlq/requeue")
    @RequiresPermission("queue:manage")
    public ResponseEntity<ApiResponse<Map<String, Object>>> requeueDeadLetters(
            @RequestBody Map<String, String> request) {
        String routingKey = request.get("routingKey");
        if (routingKey == null || routingKey.isBlank()) {
            throw new RuntimeException("routingKey 不能为空");
        }

        boolean batchMode = "true".equalsIgnoreCase(request.get("batchMode"));
        Map<String, Object> data = new HashMap<>();

        if (batchMode) {
            int count = dlqConsumerService.requeueAllDeadLetters(routingKey);
            data.put("requeuedCount", count);
            log.info("DLQ 批量重投完成：{} 条消息重投到 {}", count, routingKey);
        } else {
            boolean success = dlqConsumerService.requeueDeadLetter(routingKey);
            data.put("requeued", success);
            log.info("DLQ 单条重投 {}: routingKey={}", success ? "成功" : "失败（队列为空）", routingKey);
        }

        return ResponseEntity.ok(ApiResponse.ok("DLQ 重投操作完成", data));
    }
}
