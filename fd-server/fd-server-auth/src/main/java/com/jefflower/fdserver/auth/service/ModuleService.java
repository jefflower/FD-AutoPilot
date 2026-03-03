package com.jefflower.fdserver.auth.service;

import com.jefflower.fdserver.auth.entity.SysModule;
import com.jefflower.fdserver.auth.entity.SysPermission;
import com.jefflower.fdserver.auth.repository.SysModuleRepository;
import com.jefflower.fdserver.auth.repository.SysPermissionRepository;
import com.jefflower.fdserver.auth.repository.SysRolePermissionRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ModuleService {

    private final SysModuleRepository moduleRepository;
    private final SysPermissionRepository permissionRepository;
    private final SysRolePermissionRepository rolePermissionRepository;

    public List<SysModule> getAllModules() {
        return moduleRepository.findAll();
    }

    public List<SysModule> getEnabledModules() {
        return moduleRepository.findByEnabledTrueOrderBySortOrderAsc();
    }

    /**
     * 获取用户可访问的模块列表（含每个模块下该用户拥有的权限）
     */
    public List<Map<String, Object>> getUserModulesWithPermissions(Long userId) {
        // 获取用户拥有的权限 codes
        List<String> userPermCodes = rolePermissionRepository.findPermissionCodesByUserId(userId);
        Set<String> userPermSet = new HashSet<>(userPermCodes);

        // 获取用户可访问的模块 codes
        List<String> userModuleCodes = moduleRepository.findModuleCodesByUserId(userId);
        Set<String> moduleCodeSet = new HashSet<>(userModuleCodes);

        // 获取启用的模块，按排序
        List<SysModule> enabledModules = moduleRepository.findByEnabledTrueOrderBySortOrderAsc();

        // 组装结果
        List<Map<String, Object>> result = new ArrayList<>();
        for (SysModule module : enabledModules) {
            if (!moduleCodeSet.contains(module.getCode())) {
                continue;
            }

            // 获取该模块下的权限，过滤出用户拥有的
            List<SysPermission> modulePerms = permissionRepository.findByModule(module.getCode());
            List<String> userModulePerms = modulePerms.stream()
                    .map(SysPermission::getCode)
                    .filter(userPermSet::contains)
                    .collect(Collectors.toList());

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("code", module.getCode());
            item.put("name", module.getName());
            item.put("description", module.getDescription());
            item.put("icon", module.getIcon());
            item.put("routePath", module.getRoutePath());
            item.put("sortOrder", module.getSortOrder());
            item.put("permissions", userModulePerms);
            result.add(item);
        }

        return result;
    }

    /**
     * 获取用户的全部权限 code 列表
     */
    public List<String> getUserPermissionCodes(Long userId) {
        return rolePermissionRepository.findPermissionCodesByUserId(userId);
    }

    /**
     * 切换模块启停状态。
     * 内置模块（builtIn=true）不允许操作。
     *
     * @param moduleId 模块 ID
     * @param enabled  是否启用
     * @return 更新后的模块
     * @throws BusinessException 模块不存在或为内置模块时抛出
     */
    @Transactional
    public SysModule toggleModule(Long moduleId, boolean enabled) {
        SysModule module = moduleRepository.findById(moduleId)
                .orElseThrow(() -> new BusinessException(ErrorCode.MODULE_NOT_FOUND, "模块不存在: moduleId=" + moduleId));

        if (Boolean.TRUE.equals(module.getBuiltIn())) {
            throw new BusinessException(ErrorCode.MODULE_BUILTIN_READONLY, "内置模块不允许修改启停状态: " + module.getCode());
        }

        module.setEnabled(enabled);
        return moduleRepository.save(module);
    }
}
