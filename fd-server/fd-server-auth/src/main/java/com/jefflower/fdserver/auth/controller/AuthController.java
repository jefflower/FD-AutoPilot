package com.jefflower.fdserver.auth.controller;

import com.jefflower.fdserver.auth.dto.*;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.auth.entity.SysUser;
import com.jefflower.fdserver.auth.service.AuthService;
import com.jefflower.fdserver.auth.service.ModuleService;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Tag(name = "认证", description = "用户认证、注册、Token 管理相关接口")
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final ModuleService moduleService;

    @Operation(summary = "用户登录", description = "通过用户名和密码进行登录，返回 JWT Token 对")
    @PostMapping("/login")
    public ResponseEntity<ApiResponse<LoginResponse>> login(@Valid @RequestBody LoginRequest request) {
        LoginResponse response = authService.login(request);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @Operation(summary = "刷新令牌", description = "使用 Refresh Token 获取新的 Access Token 和 Refresh Token")
    @PostMapping("/refresh")
    public ResponseEntity<ApiResponse<LoginResponse>> refreshToken(@Valid @RequestBody RefreshTokenRequest request) {
        LoginResponse response = authService.refreshToken(request.getRefreshToken());
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @Operation(summary = "用户登出", description = "使当前 Access Token 失效")
    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<Void>> logout(HttpServletRequest request) {
        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String accessToken = authHeader.substring(7);
            authService.logout(accessToken);
        }
        return ResponseEntity.ok(ApiResponse.ok("登出成功", null));
    }

    @Operation(summary = "用户注册", description = "注册新用户，注册后需等待管理员审核通过才能登录")
    @PostMapping("/register")
    public ResponseEntity<ApiResponse<SysUser>> register(@Valid @RequestBody RegisterRequest request) {
        SysUser user = authService.register(request);
        return ResponseEntity.ok(ApiResponse.ok("注册成功，请等待管理员审核", user));
    }

    @Operation(summary = "检查管理员是否存在", description = "检查系统中是否已初始化管理员账号，用于首次启动引导")
    @GetMapping("/check-admin")
    public ResponseEntity<ApiResponse<Map<String, Boolean>>> checkAdmin() {
        boolean exists = authService.checkAdminExists();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("exists", exists)));
    }

    @Operation(summary = "初始化管理员", description = "首次启动时初始化管理员账号，需要超级密码验证")
    @PostMapping("/init-admin")
    public ResponseEntity<ApiResponse<SysUser>> initAdmin(@Valid @RequestBody InitAdminRequest request) {
        SysUser admin = authService.initAdmin("admin", request.getPassword(), request.getSuperPassword());
        return ResponseEntity.ok(ApiResponse.ok("管理员初始化成功", admin));
    }

    @Operation(summary = "超级密码重置用户密码", description = "通过超级密码强制重置指定用户的密码，无需登录")
    @PostMapping("/super-reset-password")
    public ResponseEntity<ApiResponse<Void>> superResetPassword(@Valid @RequestBody SuperResetPasswordRequest request) {
        authService.superResetPassword(request.getUsername(), request.getNewPassword(), request.getSuperPassword());
        return ResponseEntity.ok(ApiResponse.ok("密码重置成功", null));
    }

    /**
     * 获取当前用户可访问的模块列表（含每个模块下该用户拥有的权限）
     */
    @Operation(summary = "获取当前用户模块列表", description = "获取当前已登录用户可访问的模块列表，包含每个模块下该用户拥有的权限")
    @GetMapping("/me/modules")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> getMyModules(Authentication authentication) {
        if (authentication == null || authentication.getDetails() == null) {
            throw new BusinessException(ErrorCode.UNAUTHORIZED, "请先登录");
        }
        Long userId = (Long) authentication.getDetails();
        return ResponseEntity.ok(ApiResponse.ok(moduleService.getUserModulesWithPermissions(userId)));
    }

    /**
     * 获取当前用户的全部权限 code 列表
     */
    @Operation(summary = "获取当前用户权限列表", description = "获取当前已登录用户的全部权限 code 列表")
    @GetMapping("/me/permissions")
    public ResponseEntity<ApiResponse<List<String>>> getMyPermissions(Authentication authentication) {
        if (authentication == null || authentication.getDetails() == null) {
            throw new BusinessException(ErrorCode.UNAUTHORIZED, "请先登录");
        }
        Long userId = (Long) authentication.getDetails();
        return ResponseEntity.ok(ApiResponse.ok(moduleService.getUserPermissionCodes(userId)));
    }
}
