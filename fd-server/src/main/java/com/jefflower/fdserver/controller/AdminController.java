package com.jefflower.fdserver.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.dto.ApiResponse;
import com.jefflower.fdserver.auth.dto.ApproveRequest;
import com.jefflower.fdserver.ticket.entity.SyncConfig;
import com.jefflower.fdserver.ticket.entity.SyncLog;
import com.jefflower.fdserver.auth.entity.SysUser;
import com.jefflower.fdserver.ticket.enums.TriggerType;
import com.jefflower.fdserver.auth.enums.UserStatus;
import com.jefflower.fdserver.auth.service.AuthService;
import com.jefflower.fdserver.ticket.service.DlqConsumerService;
import com.jefflower.fdserver.ticket.service.FreshdeskSyncService;
import com.jefflower.fdserver.ticket.service.SyncConfigService;
import com.jefflower.fdserver.ticket.service.SystemConfigService;
import com.jefflower.fdserver.ticket.service.TicketService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import com.jefflower.fdserver.common.util.SuperPasswordVerifier;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AdminController {

    private final AuthService authService;
    private final DlqConsumerService dlqConsumerService;
    private final FreshdeskSyncService freshdeskSyncService;
    private final SyncConfigService syncConfigService;
    private final RabbitAdmin rabbitAdmin;
    private final SystemConfigService systemConfigService;
    private final TicketService ticketService;

    @Value("${app.super-password:hnlx}")
    private String superPassword;

    // ========== 用户管理 ==========

    @Deprecated
    @GetMapping("/admin/users")
    @RequiresPermission("user:read")
    public ResponseEntity<ApiResponse<Page<SysUser>>> getAllUsers(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String username,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        UserStatus userStatus = null;
        if (status != null && !status.isBlank()) {
            try {
                userStatus = UserStatus.valueOf(status.toUpperCase());
            } catch (IllegalArgumentException ignored) {
            }
        }
        Page<SysUser> users = authService.getAllUsers(
                userStatus, username, PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt")));
        return ResponseEntity.ok(ApiResponse.ok(users));
    }

    @Deprecated
    @GetMapping("/admin/users/pending")
    @RequiresPermission("user:read")
    public ResponseEntity<ApiResponse<List<SysUser>>> getPendingUsers() {
        List<SysUser> users = authService.getPendingUsers();
        return ResponseEntity.ok(ApiResponse.ok(users));
    }

    @Deprecated
    @PostMapping("/admin/users/{id}/approve")
    @RequiresPermission("user:manage")
    public ResponseEntity<ApiResponse<SysUser>> approveUser(
            @PathVariable Long id,
            @RequestBody ApproveRequest request) {
        SysUser user = authService.approveUser(id, request.getAction());
        return ResponseEntity.ok(ApiResponse.ok("用户状态更新成功", user));
    }

    @Deprecated
    @PutMapping("/admin/users/{id}/role")
    @RequiresPermission("user:manage")
    public ResponseEntity<ApiResponse<SysUser>> updateUserRole(
            @PathVariable Long id,
            @RequestBody Map<String, String> request) {
        String role = request.get("role");
        if (role == null || role.isBlank()) {
            throw new RuntimeException("角色不能为空");
        }
        SysUser user = authService.updateUserRole(id, role);
        return ResponseEntity.ok(ApiResponse.ok("角色更新成功", user));
    }

    @Deprecated
    @PostMapping("/admin/users/{id}/reset-password")
    @RequiresPermission("user:manage")
    public ResponseEntity<ApiResponse<Void>> resetPassword(
            @PathVariable Long id,
            @RequestBody Map<String, String> request) {
        String newPassword = request.get("password");
        // 密码强度校验已移至 AuthService.resetPassword()，此处仅做基本非空检查
        if (newPassword == null || newPassword.isBlank()) {
            throw new RuntimeException("密码不能为空");
        }
        authService.resetPassword(id, newPassword);
        return ResponseEntity.ok(ApiResponse.ok("密码重置成功", null));
    }

    // ========== 同步管理 ==========

    /**
     * 手动触发同步
     */
    @PostMapping("/sync/freshdesk")
    @RequiresPermission("sync:manage")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncFreshdesk() {
        FreshdeskSyncService.SyncResult result = freshdeskSyncService.syncTicketsWithLock(TriggerType.MANUAL);
        Map<String, Object> data = new HashMap<>();
        data.put("syncedCount", result.getSyncedCount());
        data.put("updatedCount", result.getUpdatedCount());
        data.put("skippedCount", result.getSkippedCount());
        data.put("success", result.isSuccess());
        data.put("message", result.getMessage());
        return ResponseEntity.ok(ApiResponse.ok(data));
    }

    /**
     * 获取同步配置
     */
    @GetMapping("/sync/config")
    @RequiresPermission("sync:read")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getSyncConfig() {
        Map<String, Object> config = new HashMap<>();
        config.put("cronExpression", syncConfigService.getCronExpression());
        config.put("syncEnabled", syncConfigService.isSyncEnabled());
        config.put("lastSyncTime", syncConfigService.getLastSyncTime());
        config.put("isSyncing", syncConfigService.isSyncing());
        return ResponseEntity.ok(ApiResponse.ok(config));
    }

    /**
     * 更新同步配置
     */
    @PutMapping("/sync/config")
    @RequiresPermission("sync:manage")
    public ResponseEntity<ApiResponse<Void>> updateSyncConfig(@RequestBody Map<String, String> request) {
        if (request.containsKey("cronExpression")) {
            syncConfigService.updateConfig(SyncConfig.KEY_SYNC_CRON, request.get("cronExpression"));
        }
        if (request.containsKey("syncEnabled")) {
            syncConfigService.updateConfig(SyncConfig.KEY_SYNC_ENABLED, request.get("syncEnabled"));
        }
        if (request.containsKey("lastSyncTime")) {
            syncConfigService.updateConfig(SyncConfig.KEY_LAST_SYNC_TIME, request.get("lastSyncTime"));
        }
        return ResponseEntity.ok(ApiResponse.ok("配置更新成功", null));
    }

    /**
     * 获取同步状态
     */
    @GetMapping("/sync/status")
    @RequiresPermission("sync:read")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getSyncStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("isSyncing", syncConfigService.isSyncing());
        status.put("lastSyncTime", syncConfigService.getLastSyncTime());
        return ResponseEntity.ok(ApiResponse.ok(status));
    }

    /**
     * 获取同步日志
     */
    @GetMapping("/sync/logs")
    @RequiresPermission("sync:read")
    public ResponseEntity<ApiResponse<Page<SyncLog>>> getSyncLogs(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        Page<SyncLog> logs = syncConfigService.getSyncLogs(PageRequest.of(page, size));
        return ResponseEntity.ok(ApiResponse.ok(logs));
    }

    // ========== 队列管理 ==========

    /**
     * 清空所有 MQ 队列并回退处理中的工单状态（需超级密码验证）
     */
    @PostMapping("/admin/queues/purge")
    @RequiresPermission("queue:manage")
    public ResponseEntity<ApiResponse<Map<String, Object>>> purgeQueues(
            @RequestBody Map<String, String> request) {
        String password = request.get("superPassword");
        if (!SuperPasswordVerifier.verify(password, superPassword)) {
            return ResponseEntity.status(403)
                    .body(ApiResponse.error("FORBIDDEN", "超级密码验证失败"));
        }

        int purgedMessages = 0;
        // 清空 4 个队列
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

        // 回退处理中的工单状态
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
    @PostMapping("/admin/tickets/purge-all")
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

    // ========== DLQ 管理 ==========

    /**
     * 手动将死信队列中的消息重新投递到指定队列
     * routingKey: 目标路由键（如 ticket.task.translate, ticket.task.reply, ticket.task.audit）
     */
    @PostMapping("/admin/dlq/requeue")
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
