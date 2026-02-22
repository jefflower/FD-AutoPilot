package com.jefflower.fdserver.workflow.config;

import com.jefflower.fdserver.auth.service.ModulePermissionDefinition;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class WorkflowPermissionDefinition implements ModulePermissionDefinition {

    @Override
    public String getModuleCode() {
        return "workflow";
    }

    @Override
    public String getModuleName() {
        return "工作流管理";
    }

    @Override
    public String getModuleDescription() {
        return "BPMN 工作流定义、部署与监控";
    }

    @Override
    public String getModuleIcon() {
        return "git-branch";
    }

    @Override
    public String getModuleRoutePath() {
        return "/workflow";
    }

    @Override
    public int getModuleSortOrder() {
        return 5;
    }

    @Override
    public Map<String, String> getPermissions() {
        Map<String, String> permissions = new LinkedHashMap<>();
        permissions.put("workflow:manage", "管理工作流定义");
        permissions.put("workflow:deploy", "部署工作流");
        permissions.put("workflow:monitor", "监控工作流实例");
        permissions.put("workflow:design", "设计工作流");
        return permissions;
    }

    @Override
    public Map<String, List<String>> getDefaultRoleAssignments() {
        Map<String, List<String>> assignments = new LinkedHashMap<>();
        assignments.put("workflow:manage", List.of("ADMIN"));
        assignments.put("workflow:deploy", List.of("ADMIN"));
        assignments.put("workflow:monitor", List.of("ADMIN"));
        assignments.put("workflow:design", List.of("ADMIN"));
        return assignments;
    }
}
