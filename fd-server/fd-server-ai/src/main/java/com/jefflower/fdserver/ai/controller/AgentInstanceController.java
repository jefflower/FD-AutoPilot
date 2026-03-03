package com.jefflower.fdserver.ai.controller;

import com.jefflower.fdserver.ai.entity.AgentInstance;
import com.jefflower.fdserver.ai.service.AgentInstanceService;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Tag(name = "Agent 实例", description = "客户端 Agent 运行实例管理、配置覆盖、在线状态")
@RestController
@RequestMapping("/api/v1/agents")
public class AgentInstanceController {

    private final AgentInstanceService instanceService;

    public AgentInstanceController(AgentInstanceService instanceService) {
        this.instanceService = instanceService;
    }

    @GetMapping("/instances")
    @RequiresPermission("ai:manage")
    public ApiResponse<List<AgentInstance>> getAllInstances() {
        return ApiResponse.ok(instanceService.getAllInstances());
    }

    @GetMapping("/{agentCode}/instances")
    public ApiResponse<List<AgentInstance>> getInstancesByAgent(@PathVariable String agentCode) {
        return ApiResponse.ok(instanceService.getInstancesByAgentCode(agentCode));
    }

    @PutMapping("/instances/{id}/config")
    @RequiresPermission("ai:manage")
    public ApiResponse<AgentInstance> updateLocalConfig(@PathVariable Long id,
                                                         @RequestBody Map<String, String> body) {
        String localConfig = body.get("localConfig");
        AgentInstance updated = instanceService.updateLocalConfig(id, localConfig);
        return ApiResponse.ok("配置更新成功", updated);
    }
}
