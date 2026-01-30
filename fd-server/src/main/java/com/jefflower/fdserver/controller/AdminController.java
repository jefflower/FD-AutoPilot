package com.jefflower.fdserver.controller;

import com.jefflower.fdserver.dto.ApiResponse;
import com.jefflower.fdserver.dto.ApproveRequest;
import com.jefflower.fdserver.entity.SyncConfig;
import com.jefflower.fdserver.entity.SyncLog;
import com.jefflower.fdserver.entity.SysUser;
import com.jefflower.fdserver.enums.TriggerType;
import com.jefflower.fdserver.service.AuthService;
import com.jefflower.fdserver.service.FreshdeskService;
import com.jefflower.fdserver.service.SyncConfigService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AdminController {

    private final AuthService authService;
    private final FreshdeskService freshdeskService;
    private final SyncConfigService syncConfigService;

    // ========== 用户管理 ==========

    @GetMapping("/admin/users/pending")
    public ResponseEntity<ApiResponse<List<SysUser>>> getPendingUsers() {
        List<SysUser> users = authService.getPendingUsers();
        return ResponseEntity.ok(ApiResponse.ok(users));
    }

    @PostMapping("/admin/users/{id}/approve")
    public ResponseEntity<ApiResponse<SysUser>> approveUser(
            @PathVariable Long id,
            @RequestBody ApproveRequest request) {
        SysUser user = authService.approveUser(id, request.getAction());
        return ResponseEntity.ok(ApiResponse.ok("用户状态更新成功", user));
    }

    // ========== 同步管理 ==========

    /**
     * 手动触发同步
     */
    @PostMapping("/sync/freshdesk")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncFreshdesk() {
        FreshdeskService.SyncResult result = freshdeskService.syncTicketsWithLock(TriggerType.MANUAL);
        Map<String, Object> data = new HashMap<>();
        data.put("syncedCount", result.getSyncedCount());
        data.put("updatedCount", result.getUpdatedCount());
        data.put("success", result.isSuccess());
        data.put("message", result.getMessage());
        return ResponseEntity.ok(ApiResponse.ok(data));
    }

    /**
     * 获取同步配置
     */
    @GetMapping("/sync/config")
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
    public ResponseEntity<ApiResponse<Page<SyncLog>>> getSyncLogs(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        Page<SyncLog> logs = syncConfigService.getSyncLogs(PageRequest.of(page, size));
        return ResponseEntity.ok(ApiResponse.ok(logs));
    }
}
