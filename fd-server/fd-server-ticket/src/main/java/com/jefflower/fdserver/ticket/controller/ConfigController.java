package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.service.SystemConfigService;
import com.jefflower.fdserver.ticket.service.notify.NotifyService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import com.jefflower.fdserver.ticket.dto.NotifyChannelConfig;

import java.util.Map;

@Tag(name = "系统配置", description = "自动推送开关、企业微信 Webhook 配置")
@RestController
@RequestMapping("/api/v1/config")
@RequiredArgsConstructor
public class ConfigController {

    private final SystemConfigService configService;
    private final NotifyService notifyService;

    @Operation(summary = "获取自动推送配置", description = "获取审核通过后是否自动推送回复到 Freshdesk 的开关状态")
    @GetMapping("/auto-reply")
    @RequiresPermission("config:read")
    public ResponseEntity<ApiResponse<Map<String, Boolean>>> getAutoReply() {
        boolean enabled = configService.isAutoReplyEnabled();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("enabled", enabled)));
    }

    @Operation(summary = "设置自动推送配置", description = "设置审核通过后是否自动推送回复到 Freshdesk")
    @PutMapping("/auto-reply")
    @RequiresPermission("config:manage")
    public ResponseEntity<ApiResponse<Void>> setAutoReply(@RequestBody Map<String, Boolean> body) {
        boolean enabled = Boolean.TRUE.equals(body.get("enabled"));
        configService.setAutoReplyEnabled(enabled);
        return ResponseEntity.ok(ApiResponse.ok("自动推送设置已更新", null));
    }

    @Operation(summary = "获取企业微信 Webhook 配置", description = "获取企业微信通知的 Webhook URL 和启用状态")
    @GetMapping("/wecom-webhook")
    @RequiresPermission("config:read")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getWeComWebhook() {
        String url = configService.getWeComWebhookUrl();
        boolean enabled = configService.isWeComNotifyEnabled();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("url", url, "enabled", enabled)));
    }

    @Operation(summary = "设置企业微信 Webhook 配置", description = "更新企业微信通知的 Webhook URL 和启用状态")
    @PutMapping("/wecom-webhook")
    @RequiresPermission("config:manage")
    public ResponseEntity<ApiResponse<Void>> setWeComWebhook(@RequestBody Map<String, Object> body) {
        if (body.containsKey("url")) {
            configService.setWeComWebhookUrl(String.valueOf(body.get("url")));
        }
        if (body.containsKey("enabled")) {
            configService.setWeComNotifyEnabled(Boolean.TRUE.equals(body.get("enabled")));
        }
        return ResponseEntity.ok(ApiResponse.ok("企业微信配置已更新", null));
    }

    @Operation(summary = "测试企业微信 Webhook", description = "发送一条测试消息到企业微信，验证 Webhook 配置是否正确")
    @PostMapping("/wecom-webhook/test")
    @RequiresPermission("config:manage")
    public ResponseEntity<ApiResponse<Map<String, Boolean>>> testWeComWebhook() {
        boolean success = notifyService.sendTestMessage();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("success", success)));
    }

    // ============ 通知渠道统一配置 API ============

    @Operation(summary = "获取通知渠道配置", description = "获取当前通知平台（企微/钉钉/关闭）及对应的 Webhook URL 和审核链接域名")
    @GetMapping("/notify-channel")
    @RequiresPermission("config:read")
    public ResponseEntity<ApiResponse<NotifyChannelConfig>> getNotifyChannel() {
        NotifyChannelConfig config = new NotifyChannelConfig();
        String platform = configService.getNotifyPlatform();
        config.setPlatform(platform);
        config.setAuditBaseUrl(configService.getAuditBaseUrl());

        // 根据平台返回对应的 webhook URL 和启用状态
        switch (platform) {
            case "dingtalk" -> {
                config.setWebhookUrl(configService.getDingTalkWebhookUrl());
                config.setEnabled(configService.isDingTalkNotifyEnabled());
            }
            default -> {
                config.setWebhookUrl(configService.getWeComWebhookUrl());
                config.setEnabled(configService.isWeComNotifyEnabled());
            }
        }

        return ResponseEntity.ok(ApiResponse.ok(config));
    }

    @Operation(summary = "设置通知渠道配置", description = "设置通知平台、Webhook URL、审核链接域名等配置")
    @PutMapping("/notify-channel")
    @RequiresPermission("config:manage")
    public ResponseEntity<ApiResponse<Void>> setNotifyChannel(@RequestBody NotifyChannelConfig config) {
        if (config.getPlatform() != null) {
            configService.setNotifyPlatform(config.getPlatform());
        }
        if (config.getAuditBaseUrl() != null) {
            configService.setAuditBaseUrl(config.getAuditBaseUrl());
        }

        // 根据平台保存对应的 webhook URL 和启用状态
        String platform = config.getPlatform() != null ? config.getPlatform() : configService.getNotifyPlatform();
        if (config.getWebhookUrl() != null) {
            switch (platform) {
                case "dingtalk" -> {
                    configService.setDingTalkWebhookUrl(config.getWebhookUrl());
                    configService.setDingTalkNotifyEnabled(config.isEnabled());
                }
                default -> {
                    configService.setWeComWebhookUrl(config.getWebhookUrl());
                    configService.setWeComNotifyEnabled(config.isEnabled());
                }
            }
        }

        return ResponseEntity.ok(ApiResponse.ok("通知渠道配置已更新", null));
    }

    @Operation(summary = "测试通知渠道", description = "发送一条测试消息到当前选择的通知平台")
    @PostMapping("/notify-channel/test")
    @RequiresPermission("config:manage")
    public ResponseEntity<ApiResponse<Map<String, Boolean>>> testNotifyChannel() {
        boolean success = notifyService.sendTestMessage();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("success", success)));
    }

}
