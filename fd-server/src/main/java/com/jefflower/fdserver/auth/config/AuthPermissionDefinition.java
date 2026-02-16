package com.jefflower.fdserver.auth.config;

import com.jefflower.fdserver.auth.service.ModulePermissionDefinition;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class AuthPermissionDefinition implements ModulePermissionDefinition {

    @Override
    public String getModuleCode() { return "auth"; }

    @Override
    public String getModuleName() { return "认证授权"; }

    @Override
    public String getModuleDescription() { return "用户管理、角色权限管理"; }

    @Override
    public String getModuleIcon() { return "shield"; }

    @Override
    public String getModuleRoutePath() { return "/auth"; }

    @Override
    public int getModuleSortOrder() { return 0; }

    @Override
    public Map<String, String> getPermissions() {
        Map<String, String> map = new LinkedHashMap<>();
        map.put("user:read", "查看用户");
        map.put("user:manage", "管理用户");
        map.put("role:read", "查看角色");
        map.put("role:manage", "管理角色");
        return map;
    }

    @Override
    public Map<String, List<String>> getDefaultRoleAssignments() {
        return Map.of(
                "user:read", List.of("ADMIN"),
                "user:manage", List.of("ADMIN"),
                "role:read", List.of("ADMIN"),
                "role:manage", List.of("ADMIN")
        );
    }
}
