package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.entity.SyncConfig;
import com.jefflower.fdserver.ticket.entity.SyncLog;
import com.jefflower.fdserver.ticket.enums.TriggerType;
import com.jefflower.fdserver.ticket.service.FreshdeskSyncService;
import com.jefflower.fdserver.ticket.service.SyncConfigService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@Tag(name = "同步管理", description = "Freshdesk 工单同步触发、配置管理、状态查询、日志查看")
@Slf4j
@RestController
@RequestMapping("/api/v1/sync")
@RequiredArgsConstructor
public class SyncController {

    private final FreshdeskSyncService freshdeskSyncService;
    private final SyncConfigService syncConfigService;

    /**
     * 手动触发同步
     */
    @Operation(summary = "手动触发 Freshdesk 同步", description = "手动触发一次 Freshdesk 工单同步，返回同步结果（新增/更新/跳过数量）")
    @PostMapping("/freshdesk")
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
    @Operation(summary = "获取同步配置", description = "获取 Freshdesk 同步的 cron 表达式、启用状态、上次同步时间等配置")
    @GetMapping("/config")
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
    @Operation(summary = "更新同步配置", description = "更新 Freshdesk 同步配置，支持修改 cron 表达式、启用状态等")
    @PutMapping("/config")
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
    @Operation(summary = "获取同步状态", description = "获取当前是否正在同步以及上次同步时间")
    @GetMapping("/status")
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
    @Operation(summary = "获取同步日志", description = "分页查询 Freshdesk 同步执行日志")
    @GetMapping("/logs")
    @RequiresPermission("sync:read")
    public ResponseEntity<ApiResponse<Page<SyncLog>>> getSyncLogs(
            @Parameter(description = "页码，从 0 开始") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "每页大小") @RequestParam(defaultValue = "10") int size) {
        Page<SyncLog> logs = syncConfigService.getSyncLogs(PageRequest.of(page, size));
        return ResponseEntity.ok(ApiResponse.ok(logs));
    }
}
