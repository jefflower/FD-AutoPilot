package com.jefflower.fdserver.controller;

import com.jefflower.fdserver.dto.ApiResponse;
import com.jefflower.fdserver.service.SystemConfigService;
import com.jefflower.fdserver.service.WeChatWorkNotifyService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/config")
@RequiredArgsConstructor
public class ConfigController {

    private final SystemConfigService configService;
    private final WeChatWorkNotifyService weChatWorkNotifyService;

    @GetMapping("/auto-reply")
    public ResponseEntity<ApiResponse<Map<String, Boolean>>> getAutoReply() {
        boolean enabled = configService.isAutoReplyEnabled();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("enabled", enabled)));
    }

    @PutMapping("/auto-reply")
    public ResponseEntity<ApiResponse<Void>> setAutoReply(@RequestBody Map<String, Boolean> body) {
        boolean enabled = Boolean.TRUE.equals(body.get("enabled"));
        configService.setAutoReplyEnabled(enabled);
        return ResponseEntity.ok(ApiResponse.ok("自动推送设置已更新", null));
    }

    @GetMapping("/wecom-webhook")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getWeComWebhook() {
        String url = configService.getWeComWebhookUrl();
        boolean enabled = configService.isWeComNotifyEnabled();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("url", url, "enabled", enabled)));
    }

    @PutMapping("/wecom-webhook")
    public ResponseEntity<ApiResponse<Void>> setWeComWebhook(@RequestBody Map<String, Object> body) {
        if (body.containsKey("url")) {
            configService.setWeComWebhookUrl(String.valueOf(body.get("url")));
        }
        if (body.containsKey("enabled")) {
            configService.setWeComNotifyEnabled(Boolean.TRUE.equals(body.get("enabled")));
        }
        return ResponseEntity.ok(ApiResponse.ok("企业微信配置已更新", null));
    }

    @PostMapping("/wecom-webhook/test")
    public ResponseEntity<ApiResponse<Map<String, Boolean>>> testWeComWebhook() {
        boolean success = weChatWorkNotifyService.sendTestMessage();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("success", success)));
    }

    @GetMapping("/mq-queues")
    public ResponseEntity<ApiResponse<Map<String, String>>> getMqQueues() {
        return ResponseEntity.ok(ApiResponse.ok(configService.getAllMqConfig()));
    }

    @PutMapping("/mq-queues")
    public ResponseEntity<ApiResponse<Void>> setMqQueues(@RequestBody Map<String, String> body) {
        configService.updateMqConfig(body);
        return ResponseEntity.ok(ApiResponse.ok("MQ 队列配置已更新", null));
    }
}
