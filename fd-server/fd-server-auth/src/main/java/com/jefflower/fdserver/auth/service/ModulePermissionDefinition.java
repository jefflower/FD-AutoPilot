package com.jefflower.fdserver.auth.service;

import java.util.List;
import java.util.Map;

public interface ModulePermissionDefinition {
    String getModuleCode();
    String getModuleName();
    String getModuleDescription();
    String getModuleIcon();
    String getModuleRoutePath();
    int getModuleSortOrder();
    Map<String, String> getPermissions();
    Map<String, List<String>> getDefaultRoleAssignments();
}
