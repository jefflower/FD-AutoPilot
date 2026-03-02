package com.jefflower.fdserver.ticket.config;

import com.jefflower.fdserver.auth.service.ModulePermissionDefinition;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class TicketPermissionDefinition implements ModulePermissionDefinition {

    @Override
    public String getModuleCode() { return "ticket"; }

    @Override
    public String getModuleName() { return "工单管理"; }

    @Override
    public String getModuleDescription() { return "工单翻译、回复、审核、推送、同步及 Freshdesk 集成"; }

    @Override
    public String getModuleIcon() { return "ticket"; }

    @Override
    public String getModuleRoutePath() { return "/ticket"; }

    @Override
    public int getModuleSortOrder() { return 1; }

    @Override
    public Map<String, String> getPermissions() {
        Map<String, String> map = new LinkedHashMap<>();
        // ticket 权限
        map.put("ticket:read", "查看工单");
        map.put("ticket:translate", "翻译工单");
        map.put("ticket:reply", "回复工单");
        map.put("ticket:audit", "审核工单");
        map.put("ticket:push", "推送回复");
        map.put("ticket:manage", "管理工单");
        // 同步管理（Freshdesk 同步属于工单业务流程）
        map.put("sync:read", "查看同步");
        map.put("sync:manage", "管理同步");
        return map;
    }

    @Override
    public Map<String, List<String>> getDefaultRoleAssignments() {
        // Map.of 最多支持 10 个 entry，此处 8 个
        return Map.of(
                "ticket:read", List.of("ADMIN", "USER", "AUDITOR"),
                "ticket:translate", List.of("ADMIN", "USER"),
                "ticket:reply", List.of("ADMIN", "USER"),
                "ticket:audit", List.of("ADMIN", "AUDITOR"),
                "ticket:push", List.of("ADMIN", "AUDITOR"),
                "ticket:manage", List.of("ADMIN"),
                "sync:read", List.of("ADMIN"),
                "sync:manage", List.of("ADMIN")
        );
    }

    @Override
    public Map<String, String> getPermissionTypes() {
        Map<String, String> types = new LinkedHashMap<>();
        types.put("ticket:read", "ROUTE");
        types.put("ticket:translate", "OPERATION");
        types.put("ticket:reply", "OPERATION");
        types.put("ticket:audit", "OPERATION");
        types.put("ticket:push", "OPERATION");
        types.put("ticket:manage", "OPERATION");
        types.put("sync:read", "ROUTE");
        types.put("sync:manage", "OPERATION");
        return types;
    }
}
