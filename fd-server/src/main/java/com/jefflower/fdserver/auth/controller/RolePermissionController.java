package com.jefflower.fdserver.auth.controller;

import com.jefflower.fdserver.auth.entity.SysPermission;
import com.jefflower.fdserver.auth.entity.SysRole;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.auth.service.RolePermissionService;
import com.jefflower.fdserver.common.dto.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 角色权限管理 Controller。
 * <p>
 * 提供角色列表、权限列表、角色权限关联的查询与设置接口。
 */
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class RolePermissionController {

    private final RolePermissionService rolePermissionService;

    @GetMapping("/roles")
    @RequiresPermission("role:read")
    public ResponseEntity<ApiResponse<List<SysRole>>> getAllRoles() {
        return ResponseEntity.ok(ApiResponse.ok(rolePermissionService.getAllRoles()));
    }

    @GetMapping("/roles/{roleId}/permissions")
    @RequiresPermission("role:read")
    public ResponseEntity<ApiResponse<List<String>>> getRolePermissions(@PathVariable Long roleId) {
        return ResponseEntity.ok(ApiResponse.ok(rolePermissionService.getPermissionsByRoleId(roleId)));
    }

    @PutMapping("/roles/{roleId}/permissions")
    @RequiresPermission("role:manage")
    public ResponseEntity<ApiResponse<Void>> setRolePermissions(
            @PathVariable Long roleId,
            @RequestBody List<String> permissionCodes) {
        rolePermissionService.setRolePermissions(roleId, permissionCodes);
        return ResponseEntity.ok(ApiResponse.ok("权限更新成功", null));
    }

    @GetMapping("/permissions")
    @RequiresPermission("role:read")
    public ResponseEntity<ApiResponse<List<SysPermission>>> getAllPermissions() {
        return ResponseEntity.ok(ApiResponse.ok(rolePermissionService.getAllPermissions()));
    }

    @GetMapping("/permissions/modules/{module}")
    @RequiresPermission("role:read")
    public ResponseEntity<ApiResponse<List<SysPermission>>> getPermissionsByModule(@PathVariable String module) {
        return ResponseEntity.ok(ApiResponse.ok(rolePermissionService.getPermissionsByModule(module)));
    }
}
