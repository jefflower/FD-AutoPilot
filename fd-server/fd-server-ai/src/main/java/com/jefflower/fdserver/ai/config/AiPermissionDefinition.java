package com.jefflower.fdserver.ai.config;

import com.jefflower.fdserver.auth.service.ModulePermissionDefinition;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class AiPermissionDefinition implements ModulePermissionDefinition {

    @Override
    public String getModuleCode() {
        return "ai";
    }

    @Override
    public String getModuleName() {
        return "AI Agent 管理";
    }

    @Override
    public String getModuleDescription() {
        return "AI Agent 定义、执行和监控";
    }

    @Override
    public String getModuleIcon() {
        return "cpu";
    }

    @Override
    public String getModuleRoutePath() {
        return "/ai";
    }

    @Override
    public int getModuleSortOrder() {
        return 4;
    }

    @Override
    public Map<String, String> getPermissions() {
        Map<String, String> permissions = new LinkedHashMap<>();
        permissions.put("ai:manage", "管理 Agent 定义");
        permissions.put("ai:execute", "执行 Agent");
        permissions.put("ai:view_logs", "查看执行日志");
        permissions.put("ai:workflow", "管理 AI 工作流");
        return permissions;
    }

    @Override
    public Map<String, List<String>> getDefaultRoleAssignments() {
        Map<String, List<String>> assignments = new LinkedHashMap<>();
        assignments.put("ai:manage", List.of("ADMIN"));
        assignments.put("ai:execute", List.of("ADMIN", "USER"));
        assignments.put("ai:view_logs", List.of("ADMIN"));
        assignments.put("ai:workflow", List.of("ADMIN"));
        return assignments;
    }

    @Override
    public Map<String, String> getPermissionTypes() {
        Map<String, String> types = new LinkedHashMap<>();
        types.put("ai:manage", "ROUTE");
        types.put("ai:execute", "OPERATION");
        types.put("ai:view_logs", "ROUTE");
        types.put("ai:workflow", "ROUTE");
        return types;
    }
}
