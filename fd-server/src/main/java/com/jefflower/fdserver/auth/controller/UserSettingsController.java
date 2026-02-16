package com.jefflower.fdserver.auth.controller;

import com.jefflower.fdserver.auth.entity.UserAppSettings;
import com.jefflower.fdserver.auth.service.UserAppSettingsService;
import com.jefflower.fdserver.common.dto.ApiResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Optional;

@Slf4j
@RestController
@RequestMapping("/api/v1/user/settings")
@RequiredArgsConstructor
public class UserSettingsController {

    private final UserAppSettingsService userAppSettingsService;

    @GetMapping("/{appCode}")
    public ResponseEntity<ApiResponse<String>> getSettings(
            @PathVariable String appCode,
            Authentication authentication) {
        Long userId = resolveUserId(authentication);
        Optional<String> settings = userAppSettingsService.getSettings(userId, appCode);
        return ResponseEntity.ok(ApiResponse.ok(settings.orElse(null)));
    }

    @PutMapping("/{appCode}")
    public ResponseEntity<ApiResponse<String>> saveSettings(
            @PathVariable String appCode,
            @RequestBody String settingsJson,
            Authentication authentication) {
        Long userId = resolveUserId(authentication);
        String saved = userAppSettingsService.saveSettings(userId, appCode, settingsJson);
        return ResponseEntity.ok(ApiResponse.ok("保存成功", saved));
    }

    @DeleteMapping("/{appCode}")
    public ResponseEntity<ApiResponse<Void>> deleteSettings(
            @PathVariable String appCode,
            Authentication authentication) {
        Long userId = resolveUserId(authentication);
        userAppSettingsService.deleteSettings(userId, appCode);
        return ResponseEntity.ok(ApiResponse.ok("删除成功", null));
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<UserAppSettings>>> getAllSettings(
            Authentication authentication) {
        Long userId = resolveUserId(authentication);
        List<UserAppSettings> settings = userAppSettingsService.getAllSettings(userId);
        return ResponseEntity.ok(ApiResponse.ok(settings));
    }

    private Long resolveUserId(Authentication authentication) {
        if (authentication == null || authentication.getDetails() == null) {
            throw new RuntimeException("未认证或无法获取用户信息");
        }
        return (Long) authentication.getDetails();
    }
}
