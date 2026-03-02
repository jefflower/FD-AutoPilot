package com.jefflower.fdserver.auth.controller;

import com.jefflower.fdserver.auth.dto.AuthConfigDTO;
import com.jefflower.fdserver.auth.dto.OrgSyncResult;
import com.jefflower.fdserver.auth.entity.OrgSyncLog;
import com.jefflower.fdserver.auth.entity.SysDepartment;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.auth.service.AuthConfigService;
import com.jefflower.fdserver.auth.service.OrgSyncService;
import com.jefflower.fdserver.common.dto.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Tag(name = "组织同步", description = "钉钉/企业微信组织架构同步、部门管理")
@RestController
@RequestMapping("/api/v1/auth/org-sync")
@RequiredArgsConstructor
public class OrgSyncController {

    private final AuthConfigService configService;
    private final OrgSyncService orgSyncService;

    @GetMapping("/config")
    @RequiresPermission("org:manage")
    public ApiResponse<AuthConfigDTO> getConfig() {
        return ApiResponse.ok(configService.getOrgSyncConfig());
    }

    @PutMapping("/config")
    @RequiresPermission("org:manage")
    public ApiResponse<Void> saveConfig(@RequestBody AuthConfigDTO dto) {
        configService.saveOrgSyncConfig(dto);
        return ApiResponse.ok(null);
    }

    @PostMapping("/trigger")
    @RequiresPermission("org:manage")
    public ApiResponse<OrgSyncResult> triggerSync(Authentication authentication) {
        String username = authentication.getName();
        OrgSyncResult result = orgSyncService.syncOrganization(username);
        return ApiResponse.ok(result);
    }

    @PostMapping("/test-connection")
    @RequiresPermission("org:manage")
    public ApiResponse<Map<String, Object>> testConnection() {
        boolean success = orgSyncService.testConnection();
        return ApiResponse.ok(Map.of("success", success));
    }

    @GetMapping("/logs")
    @RequiresPermission("org:manage")
    public ApiResponse<List<OrgSyncLog>> getSyncLogs() {
        return ApiResponse.ok(orgSyncService.getSyncLogs());
    }

    @GetMapping("/departments")
    @RequiresPermission("org:read")
    public ApiResponse<List<SysDepartment>> getDepartments() {
        return ApiResponse.ok(orgSyncService.getDepartmentTree());
    }
}
