package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.client.FreshdeskApiClient;
import com.jefflower.fdserver.ticket.service.SystemConfigService;
import com.jefflower.fdserver.ticket.service.notify.NotifyService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import com.jefflower.fdserver.ticket.dto.NotifyChannelConfig;

import java.util.Map;
import java.util.Set;

@Tag(name = "系统配置", description = "自动推送开关、企业微信 Webhook 配置")
@RestController
@RequestMapping("/api/v1/config")
@RequiredArgsConstructor
public class ConfigController {

    private final SystemConfigService configService;
    private final NotifyService notifyService;
    private final FreshdeskApiClient freshdeskApiClient;

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
    public ResponseEntity<ApiResponse<Map<String, Object>>> testWeComWebhook() {
        String error = notifyService.sendTestMessage();
        boolean success = (error == null);
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
    public ResponseEntity<ApiResponse<Map<String, Object>>> testNotifyChannel() {
        String error = notifyService.sendTestMessage();
        boolean success = error == null;
        Map<String, Object> result = new java.util.HashMap<>();
        result.put("success", success);
        if (error != null) {
            result.put("error", error);
        }
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    // ============ NotebookLM 知识库配置 API ============

    @Operation(summary = "获取 NotebookLM 知识库配置", description = "获取默认 NotebookID 和标签→知识库映射")
    @GetMapping("/notebooklm")
    @RequiresPermission("config:read")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getNotebookLmConfig() {
        Map<String, Object> config = new java.util.HashMap<>();
        config.put("defaultNotebookId", configService.getNotebookLmDefaultNotebookId());
        config.put("notebookMapping", configService.getNotebookLmNotebookMapping());
        return ResponseEntity.ok(ApiResponse.ok(config));
    }

    @Operation(summary = "设置 NotebookLM 知识库配置", description = "设置默认 NotebookID 和标签→知识库映射")
    @PutMapping("/notebooklm")
    @RequiresPermission("config:manage")
    public ResponseEntity<ApiResponse<Void>> setNotebookLmConfig(@RequestBody Map<String, String> body) {
        if (body.containsKey("defaultNotebookId")) {
            configService.setNotebookLmDefaultNotebookId(body.get("defaultNotebookId"));
        }
        if (body.containsKey("notebookMapping")) {
            configService.setNotebookLmNotebookMapping(body.get("notebookMapping"));
        }
        return ResponseEntity.ok(ApiResponse.ok("NotebookLM 配置已更新", null));
    }

    // ============ 知识库同步配置 API ============

    @Operation(summary = "获取知识库同步配置", description = "获取工单/注意事项与知识库源文件的映射关系")
    @GetMapping("/knowledge-sync")
    @RequiresPermission("config:read")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getKnowledgeSyncConfig() {
        String json = configService.getKnowledgeSyncConfig();
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> config = new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, Map.class);
            return ResponseEntity.ok(ApiResponse.ok(config));
        } catch (Exception e) {
            return ResponseEntity.ok(ApiResponse.ok(new java.util.HashMap<>()));
        }
    }

    @Operation(summary = "设置知识库同步配置", description = "设置工单/注意事项与知识库源文件的映射关系")
    @PutMapping("/knowledge-sync")
    @RequiresPermission("config:manage")
    public ResponseEntity<ApiResponse<Void>> setKnowledgeSyncConfig(@RequestBody Map<String, Object> body) {
        try {
            String json = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(body);
            configService.setKnowledgeSyncConfig(json);
            return ResponseEntity.ok(ApiResponse.ok("知识库同步配置已更新", null));
        } catch (Exception e) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "无效的配置数据");
        }
    }

    // ============ 通知语言配置 API ============

    @Operation(summary = "获取通知语言配置", description = "获取通知消息使用的语言（zh-CN/en-US）")
    @GetMapping("/notify-language")
    @RequiresPermission("config:read")
    public ResponseEntity<ApiResponse<Map<String, String>>> getNotifyLanguage() {
        String lang = configService.getNotifyLanguage();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("language", lang)));
    }

    @Operation(summary = "设置通知语言配置", description = "设置通知消息使用的语言（zh-CN/en-US）")
    @PutMapping("/notify-language")
    @RequiresPermission("config:manage")
    public ResponseEntity<ApiResponse<Void>> setNotifyLanguage(@RequestBody Map<String, String> body) {
        String lang = body.getOrDefault("language", "zh-CN");
        // 验证语言有效性
        if (!"zh-CN".equals(lang) && !"en-US".equals(lang)) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "Unsupported language: " + lang + ". Supported: zh-CN, en-US");
        }
        configService.setNotifyLanguage(lang);
        return ResponseEntity.ok(ApiResponse.ok("通知语言设置已更新", null));
    }

    // ============ Freshdesk 连接配置 API ============

    @Operation(summary = "获取 Freshdesk 连接配置", description = "获取 Freshdesk 域名和 API Key（API Key 脱敏返回）")
    @GetMapping("/freshdesk")
    @RequiresPermission("config:read")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getFreshdeskConfig() {
        String domain = configService.getFreshdeskDomain();
        String apiKey = configService.getFreshdeskApiKey();
        boolean configured = configService.isFreshdeskConfigured();

        // API Key 脱敏：只显示前4位和后4位
        String maskedApiKey = "";
        if (apiKey != null && !apiKey.isBlank()) {
            if (apiKey.length() > 8) {
                maskedApiKey = apiKey.substring(0, 4) + "****" + apiKey.substring(apiKey.length() - 4);
            } else {
                maskedApiKey = "****";
            }
        }

        Map<String, Object> config = new java.util.HashMap<>();
        config.put("domain", domain != null ? domain : "");
        config.put("apiKey", maskedApiKey);
        config.put("configured", configured);
        return ResponseEntity.ok(ApiResponse.ok(config));
    }

    @Operation(summary = "设置 Freshdesk 连接配置", description = "设置 Freshdesk 域名和 API Key")
    @PutMapping("/freshdesk")
    @RequiresPermission("config:manage")
    public ResponseEntity<ApiResponse<Void>> setFreshdeskConfig(@RequestBody Map<String, String> body) {
        if (body.containsKey("domain")) {
            configService.setFreshdeskDomain(body.get("domain"));
        }
        if (body.containsKey("apiKey")) {
            String apiKey = body.get("apiKey");
            // 如果前端传回的是脱敏值（包含 ****），则不更新 API Key
            if (apiKey != null && !apiKey.contains("****")) {
                configService.setFreshdeskApiKey(apiKey);
            }
        }
        return ResponseEntity.ok(ApiResponse.ok("Freshdesk 配置已更新", null));
    }

    @Operation(summary = "测试 Freshdesk 连接", description = "使用当前配置测试 Freshdesk API 连接是否正常")
    @PostMapping("/freshdesk/test")
    @RequiresPermission("config:manage")
    public ResponseEntity<ApiResponse<Map<String, Object>>> testFreshdeskConnection() {
        Map<String, Object> result = new java.util.HashMap<>();
        try {
            if (!configService.isFreshdeskConfigured()) {
                result.put("success", false);
                result.put("error", "Freshdesk 未配置，请先填写域名和 API Key");
                return ResponseEntity.ok(ApiResponse.ok(result));
            }
            // 尝试获取工单列表来验证连接
            freshdeskApiClient.fetchAllTickets(null, Set.of(2));
            result.put("success", true);
            result.put("message", "Freshdesk 连接成功");
        } catch (Exception e) {
            result.put("success", false);
            result.put("error", "连接失败: " + e.getMessage());
        }
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

}
