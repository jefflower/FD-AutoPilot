package com.jefflower.fdserver.ai.controller;

import com.jefflower.fdserver.ai.service.AgentBindingService;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/agents/bindings")
public class AgentBindingController {

    private final AgentBindingService bindingService;

    public AgentBindingController(AgentBindingService bindingService) {
        this.bindingService = bindingService;
    }

    @GetMapping
    public ApiResponse<Map<String, String>> getBindings() {
        return ApiResponse.ok(bindingService.getAllBindings());
    }

    @PutMapping("/{capability}")
    @RequiresPermission("ai:manage")
    public ApiResponse<Void> setBinding(@PathVariable String capability,
                                         @RequestBody Map<String, String> body) {
        String agentCode = body.get("agentCode");
        bindingService.setBinding(capability, agentCode);
        return ApiResponse.ok("绑定设置成功", null);
    }

    @DeleteMapping("/{capability}")
    @RequiresPermission("ai:manage")
    public ApiResponse<Void> removeBinding(@PathVariable String capability) {
        bindingService.removeBinding(capability);
        return ApiResponse.ok("绑定已移除", null);
    }
}
