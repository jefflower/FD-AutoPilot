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
    public String getModuleDescription() { return "工单翻译、回复、审核、推送及 Freshdesk 集成"; }

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
        return map;
    }

    @Override
    public Map<String, List<String>> getDefaultRoleAssignments() {
        return Map.of(
                "ticket:read", List.of("ADMIN", "USER", "AUDITOR"),
                "ticket:translate", List.of("ADMIN", "USER"),
                "ticket:reply", List.of("ADMIN", "USER"),
                "ticket:audit", List.of("ADMIN", "AUDITOR"),
                "ticket:push", List.of("ADMIN", "AUDITOR"),
                "ticket:manage", List.of("ADMIN")
        );
    }
}
