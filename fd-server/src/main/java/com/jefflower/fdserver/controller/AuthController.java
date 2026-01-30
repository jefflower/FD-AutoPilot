package com.jefflower.fdserver.controller;

import com.jefflower.fdserver.dto.*;
import com.jefflower.fdserver.entity.SysUser;
import com.jefflower.fdserver.service.AuthService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

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
            return ResponseEntity.status(401)
                    .body(ApiResponse.error("INVALID_CREDENTIALS", e.getMessage()));
        }
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
}
