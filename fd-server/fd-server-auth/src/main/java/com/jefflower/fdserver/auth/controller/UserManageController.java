package com.jefflower.fdserver.auth.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.auth.dto.ApproveRequest;
import com.jefflower.fdserver.auth.entity.SysUser;
import com.jefflower.fdserver.auth.enums.UserStatus;
import com.jefflower.fdserver.auth.service.AuthService;
import com.jefflower.fdserver.auth.service.RolePermissionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 用户管理 Controller（新路径 /api/v1/auth/users）。
 * <p>
 * 替代 AdminController 中 @Deprecated 的用户管理端点。
 */
@Tag(name = "用户管理", description = "用户 CRUD、审批、角色修改、密码重置")
@Slf4j
@RestController
@RequestMapping("/api/v1/auth/users")
@RequiredArgsConstructor
public class UserManageController {

    private final AuthService authService;
    private final RolePermissionService rolePermissionService;

    @Operation(summary = "查询用户列表", description = "分页查询用户列表，支持按状态和用户名过滤")
    @GetMapping
    @RequiresPermission("user:read")
    public ResponseEntity<ApiResponse<Page<SysUser>>> getAllUsers(
            @Parameter(description = "用户状态过滤（PENDING/APPROVED/REJECTED）") @RequestParam(required = false) String status,
            @Parameter(description = "用户名模糊搜索") @RequestParam(required = false) String username,
            @Parameter(description = "页码，从 0 开始") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "每页大小") @RequestParam(defaultValue = "20") int size) {
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

    @Operation(summary = "获取待审核用户列表", description = "获取所有状态为 PENDING 的待审核用户")
    @GetMapping("/pending")
    @RequiresPermission("user:read")
    public ResponseEntity<ApiResponse<List<SysUser>>> getPendingUsers() {
        List<SysUser> users = authService.getPendingUsers();
        return ResponseEntity.ok(ApiResponse.ok(users));
    }

    @Operation(summary = "审批用户", description = "批准或拒绝待审核用户的注册申请")
    @PostMapping("/{id}/approve")
    @RequiresPermission("user:manage")
    public ResponseEntity<ApiResponse<SysUser>> approveUser(
            @Parameter(description = "用户 ID") @PathVariable Long id,
            @RequestBody ApproveRequest request) {
        SysUser user = authService.approveUser(id, request.getAction());
        return ResponseEntity.ok(ApiResponse.ok("用户状态更新成功", user));
    }

    @Operation(summary = "修改用户角色（单角色）", description = "修改指定用户的角色，传入单个角色名称")
    @PutMapping("/{id}/role")
    @RequiresPermission("user:manage")
    public ResponseEntity<ApiResponse<SysUser>> updateUserRole(
            @Parameter(description = "用户 ID") @PathVariable Long id,
            @RequestBody Map<String, String> request) {
        String role = request.get("role");
        if (role == null || role.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "角色不能为空");
        }
        SysUser user = authService.updateUserRole(id, role);
        return ResponseEntity.ok(ApiResponse.ok("角色更新成功", user));
    }

    @Operation(summary = "重置用户密码", description = "管理员强制重置指定用户的密码")
    @PostMapping("/{id}/reset-password")
    @RequiresPermission("user:manage")
    public ResponseEntity<ApiResponse<Void>> resetPassword(
            @Parameter(description = "用户 ID") @PathVariable Long id,
            @RequestBody Map<String, String> request) {
        String newPassword = request.get("password");
        if (newPassword == null || newPassword.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "密码不能为空");
        }
        authService.resetPassword(id, newPassword);
        return ResponseEntity.ok(ApiResponse.ok("密码重置成功", null));
    }

    @Operation(summary = "获取用户角色列表", description = "获取指定用户的所有角色 code 列表")
    @GetMapping("/{id}/roles")
    @RequiresPermission("user:read")
    public ResponseEntity<ApiResponse<List<String>>> getUserRoles(
            @Parameter(description = "用户 ID") @PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(authService.getUserRoleCodes(id)));
    }

    @Operation(summary = "修改用户角色（多角色）", description = "设置指定用户的角色列表，传入角色 code 数组")
    @PutMapping("/{id}/roles")
    @RequiresPermission("user:manage")
    public ResponseEntity<ApiResponse<SysUser>> updateUserRoles(
            @Parameter(description = "用户 ID") @PathVariable Long id,
            @RequestBody List<String> roleCodes) {
        SysUser user = authService.updateUserRoles(id, roleCodes);
        return ResponseEntity.ok(ApiResponse.ok("角色更新成功", user));
    }

    @Operation(summary = "获取用户权限列表", description = "获取指定用户通过所有角色汇总后的权限 code 集合")
    @GetMapping("/{id}/permissions")
    @RequiresPermission("user:read")
    public ResponseEntity<ApiResponse<java.util.Set<String>>> getUserPermissions(
            @Parameter(description = "用户 ID") @PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(rolePermissionService.getUserPermissions(id)));
    }
}
