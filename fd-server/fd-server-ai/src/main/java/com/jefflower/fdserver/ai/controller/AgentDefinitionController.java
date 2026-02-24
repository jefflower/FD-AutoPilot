package com.jefflower.fdserver.ai.controller;

import com.jefflower.fdserver.ai.dto.AgentProxyTestResult;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.provider.HttpApiAgentProvider;
import com.jefflower.fdserver.ai.service.AgentDefinitionService;
import com.jefflower.fdserver.ai.service.AgentDispatchService;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/agents")
public class AgentDefinitionController {

    private final AgentDefinitionService definitionService;
    private final AgentDispatchService dispatchService;
    private final HttpApiAgentProvider httpApiAgentProvider;

    public AgentDefinitionController(AgentDefinitionService definitionService,
                                     AgentDispatchService dispatchService,
                                     HttpApiAgentProvider httpApiAgentProvider) {
        this.definitionService = definitionService;
        this.dispatchService = dispatchService;
        this.httpApiAgentProvider = httpApiAgentProvider;
    }

    @GetMapping("/definitions")
    public ApiResponse<List<AgentDefinition>> getEnabledDefinitions() {
        return ApiResponse.ok(definitionService.findEnabled());
    }

    @GetMapping("/definitions/all")
    @RequiresPermission("ai:manage")
    public ApiResponse<List<AgentDefinition>> getAllDefinitions() {
        return ApiResponse.ok(definitionService.findAll());
    }

    @PostMapping("/definitions")
    @RequiresPermission("ai:manage")
    public ApiResponse<AgentDefinition> createDefinition(@RequestBody AgentDefinition def) {
        return ApiResponse.ok("Agent 创建成功", definitionService.create(def));
    }

    @PutMapping("/definitions/{id}")
    @RequiresPermission("ai:manage")
    public ApiResponse<AgentDefinition> updateDefinition(@PathVariable Long id,
                                                          @RequestBody AgentDefinition def) {
        return ApiResponse.ok("Agent 更新成功", definitionService.update(id, def));
    }

    @PutMapping("/definitions/{id}/toggle")
    @RequiresPermission("ai:manage")
    public ApiResponse<Void> toggleDefinition(@PathVariable Long id) {
        definitionService.toggleEnabled(id);
        return ApiResponse.ok("操作成功", null);
    }

    @DeleteMapping("/definitions/{id}")
    @RequiresPermission("ai:manage")
    public ApiResponse<Void> deleteDefinition(@PathVariable Long id) {
        definitionService.delete(id);
        return ApiResponse.ok("Agent 删除成功", null);
    }

    @GetMapping("/definitions/client")
    public ApiResponse<List<AgentDefinition>> getClientExecutableAgents() {
        return ApiResponse.ok(dispatchService.getClientExecutableAgents());
    }

    @GetMapping("/definitions/capability/{capability}")
    public ApiResponse<List<AgentDefinition>> getByCapability(@PathVariable String capability) {
        return ApiResponse.ok(definitionService.findByCapability(capability));
    }

    @GetMapping("/definitions/group/{groupCode}")
    public ApiResponse<List<AgentDefinition>> getByGroupCode(@PathVariable String groupCode) {
        return ApiResponse.ok(definitionService.findByGroupCode(groupCode));
    }

    @GetMapping("/definitions/groups")
    public ApiResponse<List<String>> getGroupCodes() {
        return ApiResponse.ok(definitionService.getGroupCodes());
    }

    @PostMapping("/definitions/test-proxy")
    @RequiresPermission("ai:manage")
    public ApiResponse<AgentProxyTestResult> testProxy(@RequestBody Map<String, String> body) {
        String baseUrl = body.getOrDefault("baseUrl", "");
        String apiKey = body.getOrDefault("apiKey", "");
        AgentProxyTestResult result = httpApiAgentProvider.testProxy(baseUrl, apiKey);
        return ApiResponse.ok(result);
    }
}
