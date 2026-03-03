package com.jefflower.fdserver.auth.controller;

import com.jefflower.fdserver.auth.entity.UserAppSettings;
import com.jefflower.fdserver.auth.service.UserAppSettingsService;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Optional;

@Tag(name = "用户设置", description = "用户应用级设置的存取管理（如翻译语言、NotebookLM 配置等）")
@Slf4j
@RestController
@RequestMapping("/api/v1/user/settings")
@RequiredArgsConstructor
public class UserSettingsController {

    private final UserAppSettingsService userAppSettingsService;

    @Operation(summary = "获取指定应用设置", description = "获取当前用户指定应用 code 的设置 JSON 字符串")
    @GetMapping("/{appCode}")
    public ResponseEntity<ApiResponse<String>> getSettings(
            @Parameter(description = "应用代码，如 fd-web") @PathVariable String appCode,
            Authentication authentication) {
        Long userId = resolveUserId(authentication);
        Optional<String> settings = userAppSettingsService.getSettings(userId, appCode);
        return ResponseEntity.ok(ApiResponse.ok(settings.orElse(null)));
    }

    @Operation(summary = "保存/更新应用设置", description = "保存或更新当前用户指定应用的设置，请求体为 JSON 字符串")
    @PutMapping("/{appCode}")
    public ResponseEntity<ApiResponse<String>> saveSettings(
            @Parameter(description = "应用代码") @PathVariable String appCode,
            @RequestBody String settingsJson,
            Authentication authentication) {
        Long userId = resolveUserId(authentication);
        String saved = userAppSettingsService.saveSettings(userId, appCode, settingsJson);
        return ResponseEntity.ok(ApiResponse.ok("保存成功", saved));
    }

    @Operation(summary = "删除应用设置", description = "删除当前用户指定应用的设置")
    @DeleteMapping("/{appCode}")
    public ResponseEntity<ApiResponse<Void>> deleteSettings(
            @Parameter(description = "应用代码") @PathVariable String appCode,
            Authentication authentication) {
        Long userId = resolveUserId(authentication);
        userAppSettingsService.deleteSettings(userId, appCode);
        return ResponseEntity.ok(ApiResponse.ok("删除成功", null));
    }

    @Operation(summary = "获取所有应用设置", description = "获取当前用户所有应用的设置列表")
    @GetMapping
    public ResponseEntity<ApiResponse<List<UserAppSettings>>> getAllSettings(
            Authentication authentication) {
        Long userId = resolveUserId(authentication);
        List<UserAppSettings> settings = userAppSettingsService.getAllSettings(userId);
        return ResponseEntity.ok(ApiResponse.ok(settings));
    }

    private Long resolveUserId(Authentication authentication) {
        if (authentication == null || authentication.getDetails() == null) {
            throw new BusinessException(ErrorCode.UNAUTHORIZED, "未认证或无法获取用户信息");
        }
        return (Long) authentication.getDetails();
    }
}
