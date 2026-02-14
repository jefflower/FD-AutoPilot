package com.jefflower.fdserver.auth.controller;

import com.jefflower.fdserver.auth.dto.*;
import com.jefflower.fdserver.dto.ApiResponse;
import com.jefflower.fdserver.auth.entity.SysUser;
import com.jefflower.fdserver.auth.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<LoginResponse>> login(@Valid @RequestBody LoginRequest request) {
        try {
            LoginResponse response = authService.login(request);
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (RuntimeException e) {
            String msg = e.getMessage();
            return switch (msg) {
                case "USER_NOT_FOUND" -> ResponseEntity.status(401)
                        .body(ApiResponse.error("USER_NOT_FOUND", "用户不存在"));
                case "WRONG_PASSWORD" -> ResponseEntity.status(401)
                        .body(ApiResponse.error("WRONG_PASSWORD", "密码错误"));
                case "USER_NOT_APPROVED" -> ResponseEntity.status(403)
                        .body(ApiResponse.error("USER_NOT_APPROVED", "用户尚未审核通过"));
                default -> ResponseEntity.status(401)
                        .body(ApiResponse.error("INVALID_CREDENTIALS", msg));
            };
        }
    }

    @PostMapping("/refresh")
    public ResponseEntity<ApiResponse<LoginResponse>> refreshToken(@Valid @RequestBody RefreshTokenRequest request) {
        try {
            LoginResponse response = authService.refreshToken(request.getRefreshToken());
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (RuntimeException e) {
            String msg = e.getMessage();
            return switch (msg) {
                case "INVALID_REFRESH_TOKEN" -> ResponseEntity.status(401)
                        .body(ApiResponse.error("INVALID_REFRESH_TOKEN", "Refresh Token 无效或已过期"));
                default -> ResponseEntity.status(401)
                        .body(ApiResponse.error("REFRESH_FAILED", msg));
            };
        }
    }

    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<Void>> logout(HttpServletRequest request) {
        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String accessToken = authHeader.substring(7);
            authService.logout(accessToken);
        }
        return ResponseEntity.ok(ApiResponse.ok("登出成功", null));
    }

    @PostMapping("/register")
    public ResponseEntity<ApiResponse<SysUser>> register(@Valid @RequestBody RegisterRequest request) {
        try {
            SysUser user = authService.register(request);
            return ResponseEntity.ok(ApiResponse.ok("注册成功，请等待管理员审核", user));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("REGISTER_FAILED", e.getMessage()));
        }
    }

    @GetMapping("/check-admin")
    public ResponseEntity<ApiResponse<Map<String, Boolean>>> checkAdmin() {
        boolean exists = authService.checkAdminExists();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("exists", exists)));
    }

    @PostMapping("/init-admin")
    public ResponseEntity<ApiResponse<SysUser>> initAdmin(@Valid @RequestBody InitAdminRequest request) {
        try {
            SysUser admin = authService.initAdmin("admin", request.getPassword(), request.getSuperPassword());
            return ResponseEntity.ok(ApiResponse.ok("管理员初始化成功", admin));
        } catch (RuntimeException e) {
            String msg = e.getMessage();
            return switch (msg) {
                case "INVALID_SUPER_PASSWORD" -> ResponseEntity.status(403)
                        .body(ApiResponse.error("INVALID_SUPER_PASSWORD", "超级密码错误"));
                case "ADMIN_ALREADY_EXISTS" -> ResponseEntity.status(409)
                        .body(ApiResponse.error("ADMIN_ALREADY_EXISTS", "管理员已存在"));
                default -> ResponseEntity.badRequest()
                        .body(ApiResponse.error("INIT_ADMIN_FAILED", msg));
            };
        }
    }

    @PostMapping("/super-reset-password")
    public ResponseEntity<ApiResponse<Void>> superResetPassword(@Valid @RequestBody SuperResetPasswordRequest request) {
        try {
            authService.superResetPassword(request.getUsername(), request.getNewPassword(), request.getSuperPassword());
            return ResponseEntity.ok(ApiResponse.ok("密码重置成功", null));
        } catch (RuntimeException e) {
            String msg = e.getMessage();
            return switch (msg) {
                case "INVALID_SUPER_PASSWORD" -> ResponseEntity.status(403)
                        .body(ApiResponse.error("INVALID_SUPER_PASSWORD", "超级密码错误"));
                case "USER_NOT_FOUND" -> ResponseEntity.status(404)
                        .body(ApiResponse.error("USER_NOT_FOUND", "用户不存在"));
                default -> ResponseEntity.badRequest()
                        .body(ApiResponse.error("RESET_FAILED", msg));
            };
        }
    }
}
