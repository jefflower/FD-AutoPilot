package com.jefflower.fdserver.task.config;

import com.jefflower.fdserver.auth.service.ModulePermissionDefinition;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class TaskPermissionDefinition implements ModulePermissionDefinition {

    @Override
    public String getModuleCode() { return "task"; }

    @Override
    public String getModuleName() { return "任务调度"; }

    @Override
    public String getModuleDescription() { return "任务分发与调度管理"; }

    @Override
    public String getModuleIcon() { return "ListTodo"; }

    @Override
    public String getModuleRoutePath() { return "/task"; }

    @Override
    public int getModuleSortOrder() { return 50; }

    @Override
    public Map<String, String> getPermissions() {
        Map<String, String> map = new LinkedHashMap<>();
        map.put("task:read", "查看任务");
        map.put("task:claim", "领取任务");
        map.put("task:manage", "管理任务");
        map.put("task:trigger", "触发任务");
        return map;
    }

    @Override
    public Map<String, List<String>> getDefaultRoleAssignments() {
        return Map.of(
                "task:read", List.of("ADMIN", "USER", "AUDITOR"),
                "task:claim", List.of("ADMIN", "USER", "AUDITOR"),
                "task:manage", List.of("ADMIN"),
                "task:trigger", List.of("ADMIN")
        );
    }
}
