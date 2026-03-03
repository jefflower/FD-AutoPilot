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

    /**
     * 获取权限类型映射 (permCode -> type)
     * 枚举值: ROUTE(路由/页面访问权限), OPERATION(操作权限), DATA(数据权限)
     * 默认返回空 Map，现有实现不需要强制修改
     */
    default Map<String, String> getPermissionTypes() {
        return Map.of();
    }
}
