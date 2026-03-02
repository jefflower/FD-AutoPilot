package com.jefflower.fdserver.ticket.config;

import com.jefflower.fdserver.auth.service.ModulePermissionDefinition;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class SystemPermissionDefinition implements ModulePermissionDefinition {

    @Override
    public String getModuleCode() { return "system"; }

    @Override
    public String getModuleName() { return "系统管理"; }

    @Override
    public String getModuleDescription() { return "知识库、数据库查询、系统配置"; }

    @Override
    public String getModuleIcon() { return "settings"; }

    @Override
    public String getModuleRoutePath() { return "/system"; }

    @Override
    public int getModuleSortOrder() { return 2; }

    @Override
    public Map<String, String> getPermissions() {
        Map<String, String> map = new LinkedHashMap<>();
        map.put("config:read", "查看配置");
        map.put("config:manage", "管理配置");
        map.put("knowledge:read", "查看知识库");
        map.put("knowledge:manage", "管理知识库");
        map.put("database:query", "数据库查询");
        return map;
    }

    @Override
    public Map<String, List<String>> getDefaultRoleAssignments() {
        return Map.of(
                "config:read", List.of("ADMIN"),
                "config:manage", List.of("ADMIN"),
                "knowledge:read", List.of("ADMIN"),
                "knowledge:manage", List.of("ADMIN"),
                "database:query", List.of()
        );
    }

    @Override
    public Map<String, String> getPermissionTypes() {
        Map<String, String> types = new LinkedHashMap<>();
        types.put("config:read", "ROUTE");
        types.put("config:manage", "OPERATION");
        types.put("knowledge:read", "ROUTE");
        types.put("knowledge:manage", "OPERATION");
        types.put("database:query", "DATA");
        return types;
    }
}
