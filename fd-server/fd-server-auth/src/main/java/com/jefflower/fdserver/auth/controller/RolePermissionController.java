package com.jefflower.fdserver.auth.controller;

import com.jefflower.fdserver.auth.entity.SysModule;
import com.jefflower.fdserver.auth.entity.SysPermission;
import com.jefflower.fdserver.auth.entity.SysRole;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.auth.service.ModuleService;
import com.jefflower.fdserver.auth.service.RolePermissionService;
import com.jefflower.fdserver.common.dto.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 角色权限管理 Controller。
 * <p>
 * 提供角色列表、权限列表、角色权限关联的查询与设置接口。
 */
@Tag(name = "角色权限", description = "角色列表、权限列表、角色权限关联的查询与设置")
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class RolePermissionController {

    private final RolePermissionService rolePermissionService;
    private final ModuleService moduleService;

    @Operation(summary = "获取所有角色", description = "获取系统中所有角色列表")
    @GetMapping("/roles")
    @RequiresPermission("role:read")
    public ResponseEntity<ApiResponse<List<SysRole>>> getAllRoles() {
        return ResponseEntity.ok(ApiResponse.ok(rolePermissionService.getAllRoles()));
    }

    @Operation(summary = "获取角色权限", description = "获取指定角色关联的权限 code 列表")
    @GetMapping("/roles/{roleId}/permissions")
    @RequiresPermission("role:read")
    public ResponseEntity<ApiResponse<List<String>>> getRolePermissions(
            @Parameter(description = "角色 ID") @PathVariable Long roleId) {
        return ResponseEntity.ok(ApiResponse.ok(rolePermissionService.getPermissionsByRoleId(roleId)));
    }

    @Operation(summary = "设置角色权限", description = "为指定角色设置权限列表，传入权限 code 数组（全量覆盖）")
    @PutMapping("/roles/{roleId}/permissions")
    @RequiresPermission("role:manage")
    public ResponseEntity<ApiResponse<Void>> setRolePermissions(
            @Parameter(description = "角色 ID") @PathVariable Long roleId,
            @RequestBody List<String> permissionCodes) {
        rolePermissionService.setRolePermissions(roleId, permissionCodes);
        return ResponseEntity.ok(ApiResponse.ok("权限更新成功", null));
    }

    @Operation(summary = "获取所有权限", description = "获取系统中所有权限定义列表")
    @GetMapping("/permissions")
    @RequiresPermission("role:read")
    public ResponseEntity<ApiResponse<List<SysPermission>>> getAllPermissions() {
        return ResponseEntity.ok(ApiResponse.ok(rolePermissionService.getAllPermissions()));
    }

    @Operation(summary = "按模块获取权限", description = "获取指定模块下的权限列表")
    @GetMapping("/permissions/modules/{module}")
    @RequiresPermission("role:read")
    public ResponseEntity<ApiResponse<List<SysPermission>>> getPermissionsByModule(
            @Parameter(description = "模块 code") @PathVariable String module) {
        return ResponseEntity.ok(ApiResponse.ok(rolePermissionService.getPermissionsByModule(module)));
    }

    @Operation(summary = "获取所有模块", description = "获取系统中所有已启用的模块列表")
    @GetMapping("/modules")
    @RequiresPermission("role:read")
    public ResponseEntity<ApiResponse<List<SysModule>>> getAllModules() {
        return ResponseEntity.ok(ApiResponse.ok(moduleService.getEnabledModules()));
    }

    @Operation(summary = "启用/禁用模块", description = "切换指定模块的启用状态")
    @PutMapping("/modules/{id}/toggle")
    @RequiresPermission("role:manage")
    public ResponseEntity<ApiResponse<SysModule>> toggleModule(
            @Parameter(description = "模块 ID") @PathVariable Long id,
            @RequestBody Map<String, Boolean> body) {
        Boolean enabled = body.get("enabled");
        if (enabled == null) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("BAD_REQUEST", "缺少 enabled 参数"));
        }
        SysModule module = moduleService.toggleModule(id, enabled);
        return ResponseEntity.ok(ApiResponse.ok(module));
    }

    @Operation(summary = "获取权限总览", description = "获取按模块分组的权限总览信息，包含角色-权限关联矩阵")
    @GetMapping("/permission-overview")
    @RequiresPermission("role:read")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getPermissionOverview() {
        return ResponseEntity.ok(ApiResponse.ok(rolePermissionService.getPermissionOverview()));
    }
}
