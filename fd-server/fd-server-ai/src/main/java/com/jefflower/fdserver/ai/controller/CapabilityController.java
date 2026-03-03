package com.jefflower.fdserver.ai.controller;

import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import com.jefflower.fdserver.ai.service.CapabilityDefinitionService;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "Capability 管理", description = "AI 执行能力的列表、启停、开关控制")
@RestController
@RequestMapping("/api/v1/capabilities")
public class CapabilityController {

    private final CapabilityDefinitionService capabilityService;

    public CapabilityController(CapabilityDefinitionService capabilityService) {
        this.capabilityService = capabilityService;
    }

    @GetMapping
    public ApiResponse<List<CapabilityDefinition>> getEnabledCapabilities() {
        return ApiResponse.ok(capabilityService.getEnabledCapabilities());
    }

    @GetMapping("/all")
    @RequiresPermission("ai:manage")
    public ApiResponse<List<CapabilityDefinition>> getAllCapabilities() {
        return ApiResponse.ok(capabilityService.getAllCapabilities());
    }

    @GetMapping("/{code}")
    public ApiResponse<CapabilityDefinition> getByCode(@PathVariable String code) {
        return ApiResponse.ok(capabilityService.getByCode(code));
    }

    @PostMapping
    @RequiresPermission("ai:manage")
    public ApiResponse<CapabilityDefinition> create(@RequestBody CapabilityDefinition cap) {
        return ApiResponse.ok("Capability 创建成功", capabilityService.create(cap));
    }

    @PutMapping("/{id}")
    @RequiresPermission("ai:manage")
    public ApiResponse<CapabilityDefinition> update(@PathVariable Long id,
                                                     @RequestBody CapabilityDefinition cap) {
        return ApiResponse.ok("Capability 更新成功", capabilityService.update(id, cap));
    }

    @DeleteMapping("/{id}")
    @RequiresPermission("ai:manage")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        capabilityService.delete(id);
        return ApiResponse.ok("Capability 删除成功", null);
    }

    @PutMapping("/{id}/toggle")
    @RequiresPermission("ai:manage")
    public ApiResponse<Void> toggleEnabled(@PathVariable Long id) {
        capabilityService.toggleEnabled(id);
        return ApiResponse.ok("操作成功", null);
    }
}
