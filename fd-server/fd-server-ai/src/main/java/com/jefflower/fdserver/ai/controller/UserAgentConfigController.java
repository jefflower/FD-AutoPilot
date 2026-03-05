package com.jefflower.fdserver.ai.controller;

import com.jefflower.fdserver.ai.dto.UserAgentConfigDTO;
import com.jefflower.fdserver.ai.dto.UserAgentConfigUpdateRequest;
import com.jefflower.fdserver.ai.dto.UserAgentSubscribeRequest;
import com.jefflower.fdserver.ai.service.UserAgentConfigService;
import com.jefflower.fdserver.common.dto.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "用户 Agent 配置", description = "用户级 Agent 订阅、退订、配置管理")
@RestController
@RequestMapping("/api/v1/user-agents")
public class UserAgentConfigController {

    private final UserAgentConfigService service;

    public UserAgentConfigController(UserAgentConfigService service) {
        this.service = service;
    }

    /** 获取当前用户已订阅的 Agent 列表（含 definition 摘要） */
    @GetMapping
    public ApiResponse<List<UserAgentConfigDTO>> getUserAgents(Authentication auth) {
        return ApiResponse.ok(service.getUserAgents(extractUserId(auth)));
    }

    /** 获取当前用户已订阅的 agentCode 列表（轻量） */
    @GetMapping("/codes")
    public ApiResponse<List<String>> getUserAgentCodes(Authentication auth) {
        return ApiResponse.ok(service.getUserAgentCodes(extractUserId(auth)));
    }

    /** 订阅 Agent（自动批准） */
    @PostMapping("/subscribe")
    public ApiResponse<UserAgentConfigDTO> subscribe(@RequestBody UserAgentSubscribeRequest request,
                                                      Authentication auth) {
        return ApiResponse.ok("订阅成功", service.subscribe(extractUserId(auth), request.getAgentCode()));
    }

    /** 退订 Agent */
    @DeleteMapping("/{agentCode}")
    public ApiResponse<Void> unsubscribe(@PathVariable String agentCode, Authentication auth) {
        service.unsubscribe(extractUserId(auth), agentCode);
        return ApiResponse.ok("退订成功", null);
    }

    /** 更新 Agent 配置（autoStart / enabled） */
    @PutMapping("/{agentCode}/config")
    public ApiResponse<UserAgentConfigDTO> updateConfig(@PathVariable String agentCode,
                                                         @RequestBody UserAgentConfigUpdateRequest request,
                                                         Authentication auth) {
        return ApiResponse.ok("配置更新成功", service.updateConfig(extractUserId(auth), agentCode, request));
    }

    private String extractUserId(Authentication auth) {
        if (auth != null && auth.getDetails() != null) {
            return String.valueOf(auth.getDetails());
        }
        return auth != null ? auth.getName() : "anonymous";
    }
}
