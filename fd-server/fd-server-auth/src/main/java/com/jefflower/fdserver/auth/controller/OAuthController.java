package com.jefflower.fdserver.auth.controller;

import com.jefflower.fdserver.auth.dto.LoginResponse;
import com.jefflower.fdserver.auth.dto.OAuthLoginRequest;
import com.jefflower.fdserver.auth.service.OAuthService;
import com.jefflower.fdserver.common.dto.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth/oauth")
@RequiredArgsConstructor
public class OAuthController {

    private final OAuthService oauthService;

    @GetMapping("/status")
    public ApiResponse<Map<String, Object>> getOAuthStatus() {
        return ApiResponse.ok(oauthService.getOAuthStatus());
    }

    @GetMapping("/{platform}/url")
    public ApiResponse<Map<String, String>> getOAuthUrl(
            @PathVariable String platform,
            @RequestParam String redirectUri) {
        String url = oauthService.getOAuthUrl(platform, redirectUri);
        return ApiResponse.ok(Map.of("url", url));
    }

    @PostMapping("/{platform}/callback")
    public ApiResponse<LoginResponse> oauthCallback(
            @PathVariable String platform,
            @Valid @RequestBody OAuthLoginRequest request) {
        LoginResponse response = oauthService.oauthLogin(platform, request.getAuthCode());
        return ApiResponse.ok(response);
    }
}
