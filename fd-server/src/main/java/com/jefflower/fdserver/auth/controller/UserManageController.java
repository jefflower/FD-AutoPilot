package com.jefflower.fdserver.auth.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.auth.dto.ApproveRequest;
import com.jefflower.fdserver.auth.entity.SysUser;
import com.jefflower.fdserver.auth.enums.UserStatus;
import com.jefflower.fdserver.auth.service.AuthService;
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
@Slf4j
@RestController
@RequestMapping("/api/v1/auth/users")
@RequiredArgsConstructor
public class UserManageController {

    private final AuthService authService;

    @GetMapping
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

    @GetMapping("/pending")
    @RequiresPermission("user:read")
    public ResponseEntity<ApiResponse<List<SysUser>>> getPendingUsers() {
        List<SysUser> users = authService.getPendingUsers();
        return ResponseEntity.ok(ApiResponse.ok(users));
    }

    @PostMapping("/{id}/approve")
    @RequiresPermission("user:manage")
    public ResponseEntity<ApiResponse<SysUser>> approveUser(
            @PathVariable Long id,
            @RequestBody ApproveRequest request) {
        SysUser user = authService.approveUser(id, request.getAction());
        return ResponseEntity.ok(ApiResponse.ok("用户状态更新成功", user));
    }

    @PutMapping("/{id}/role")
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

    @PostMapping("/{id}/reset-password")
    @RequiresPermission("user:manage")
    public ResponseEntity<ApiResponse<Void>> resetPassword(
            @PathVariable Long id,
            @RequestBody Map<String, String> request) {
        String newPassword = request.get("password");
        if (newPassword == null || newPassword.isBlank()) {
            throw new RuntimeException("密码不能为空");
        }
        authService.resetPassword(id, newPassword);
        return ResponseEntity.ok(ApiResponse.ok("密码重置成功", null));
    }
}
