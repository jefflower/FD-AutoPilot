package com.jefflower.fdserver.auth.service;

import com.jefflower.fdserver.auth.entity.SysModule;
import com.jefflower.fdserver.auth.entity.SysPermission;
import com.jefflower.fdserver.auth.entity.SysRole;
import com.jefflower.fdserver.auth.entity.SysRolePermission;
import com.jefflower.fdserver.auth.repository.SysModuleRepository;
import com.jefflower.fdserver.auth.repository.SysPermissionRepository;
import com.jefflower.fdserver.auth.repository.SysRolePermissionRepository;
import com.jefflower.fdserver.auth.repository.SysRoleRepository;
import com.jefflower.fdserver.auth.repository.SysUserRoleRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/**
 * 角色权限管理服务：提供角色 CRUD、权限查询、角色-权限关联管理。
 * <p>
 * 角色权限变更时会自动清除受影响用户的权限缓存。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RolePermissionService {

    private final SysRoleRepository roleRepository;
    private final SysPermissionRepository permissionRepository;
    private final SysRolePermissionRepository rolePermissionRepository;
    private final SysUserRoleRepository userRoleRepository;
    private final SysModuleRepository moduleRepository;
    private final PermissionCacheService permissionCacheService;

    // ==================== 角色 CRUD ====================

    /**
     * 获取所有角色列表
     */
    public List<SysRole> getAllRoles() {
        return roleRepository.findAll();
    }

    /**
     * 根据角色编码查询角色
     *
     * @param code 角色编码
     * @return 角色（可能为空）
     */
    public Optional<SysRole> getRoleByCode(String code) {
        return roleRepository.findByCode(code);
    }

    // ==================== 权限 CRUD ====================

    /**
     * 获取所有权限列表
     */
    public List<SysPermission> getAllPermissions() {
        return permissionRepository.findAll();
    }

    /**
     * 按模块查询权限列表
     *
     * @param module 模块名称（如 "ticket", "user", "system"）
     * @return 该模块下的权限列表
     */
    public List<SysPermission> getPermissionsByModule(String module) {
        return permissionRepository.findByModule(module);
    }

    /**
     * 创建自定义权限（非 builtIn）
     *
     * @param code        权限代码（唯一）
     * @param name        权限名称
     * @param module      所属模块
     * @param description 权限描述
     * @param type        权限类型 (ROUTE, OPERATION, DATA)
     * @return 新创建的权限
     * @throws BusinessException 权限代码已存在时抛出
     */
    @Transactional
    public SysPermission createPermission(String code, String name, String module, String description, String type) {
        if (permissionRepository.existsByCode(code)) {
            throw new BusinessException(ErrorCode.PERMISSION_ALREADY_EXISTS, "权限代码已存在: " + code);
        }

        SysPermission perm = new SysPermission(code, name, module);
        perm.setDescription(description);
        perm.setType(type);
        perm.setBuiltIn(false);

        return permissionRepository.save(perm);
    }

    /**
     * 编辑权限
     * <p>
     * 内置权限 (builtIn=true) 只能修改 name 和 description
     * 非内置权限可以修改 name, description, type
     *
     * @param id          权限 ID
     * @param name        新的权限名称
     * @param description 新的权限描述
     * @param type        新的权限类型（非内置权限）
     * @return 更新后的权限
     * @throws BusinessException 权限不存在时抛出
     */
    @Transactional
    public SysPermission updatePermission(Long id, String name, String description, String type) {
        SysPermission perm = permissionRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.PERMISSION_NOT_FOUND, "权限不存在: id=" + id));

        if (name != null) {
            perm.setName(name);
        }
        if (description != null) {
            perm.setDescription(description);
        }
        // 只有非内置权限才能修改 type
        if (type != null && !Boolean.TRUE.equals(perm.getBuiltIn())) {
            perm.setType(type);
        }

        return permissionRepository.save(perm);
    }

    /**
     * 删除权限（仅非 builtIn）
     *
     * @param id 权限 ID
     * @throws BusinessException 权限不存在或是内置权限时抛出
     */
    @Transactional
    public void deletePermission(Long id) {
        SysPermission perm = permissionRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.PERMISSION_NOT_FOUND, "权限不存在: id=" + id));

        if (Boolean.TRUE.equals(perm.getBuiltIn())) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "内置权限不可删除: " + perm.getCode());
        }

        // 删除所有关联的角色权限
        rolePermissionRepository.deleteByPermissionId(id);

        // 删除权限
        permissionRepository.deleteById(id);

        log.info("权限已删除: {} (id={})", perm.getCode(), id);
    }

    // ==================== 角色-权限关联管理 ====================

    /**
     * 获取角色的权限代码列表
     *
     * @param roleId 角色 ID
     * @return 权限代码列表
     */
    public List<String> getPermissionsByRoleId(Long roleId) {
        return rolePermissionRepository.findPermissionCodesByRoleIds(List.of(roleId));
    }

    /**
     * 设置角色权限（全量替换）。
     * <p>
     * 删除该角色原有的所有权限关联，然后添加新的关联。
     * 操作完成后自动清除受影响用户的权限缓存。
     *
     * @param roleId          角色 ID
     * @param permissionCodes 新的权限代码列表
     * @throws BusinessException 角色不存在或权限代码无效时抛出
     */
    @Transactional
    public void setRolePermissions(Long roleId, List<String> permissionCodes) {
        SysRole role = roleRepository.findById(roleId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROLE_NOT_FOUND, "角色不存在: roleId=" + roleId));

        // 删除旧关联
        rolePermissionRepository.deleteByRoleId(roleId);

        // 添加新关联
        for (String code : permissionCodes) {
            SysPermission perm = permissionRepository.findByCode(code)
                    .orElseThrow(() -> new BusinessException(ErrorCode.PERMISSION_NOT_FOUND, "权限不存在: " + code));
            rolePermissionRepository.save(new SysRolePermission(roleId, perm.getId()));
        }

        // 清除受影响用户的权限缓存
        List<Long> affectedUserIds = userRoleRepository.findUserIdsByRoleId(roleId);
        permissionCacheService.evictByRoleId(roleId, affectedUserIds);

        log.info("角色 {} (id={}) 权限已更新: {}", role.getCode(), roleId, permissionCodes);
    }

    // ==================== 用户权限查询 ====================

    /**
     * 获取用户的所有权限（带缓存）
     *
     * @param userId 用户 ID
     * @return 权限代码集合
     */
    public Set<String> getUserPermissions(Long userId) {
        return permissionCacheService.getUserPermissions(userId);
    }

    // ==================== 权限总览 ====================

    /**
     * 获取权限总览矩阵数据：所有模块、权限、角色及每个角色对应的权限列表。
     *
     * @return 包含 modules, permissions, roles, matrix, stats 的完整数据
     */
    public Map<String, Object> getPermissionOverview() {
        List<SysModule> modules = moduleRepository.findAllByOrderBySortOrderAsc();
        List<SysPermission> permissions = permissionRepository.findAll();
        List<SysRole> roles = roleRepository.findAll();

        // 构建 matrix: roleCode -> [permissionCode, ...]
        Map<String, List<String>> matrix = new LinkedHashMap<>();
        for (SysRole role : roles) {
            List<String> permCodes = rolePermissionRepository.findPermissionCodesByRoleIds(List.of(role.getId()));
            matrix.put(role.getCode(), permCodes);
        }

        // 构建 stats
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("moduleCount", modules.size());
        stats.put("permissionCount", permissions.size());
        stats.put("roleCount", roles.size());

        // 组装结果
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("modules", modules);
        result.put("permissions", permissions);
        result.put("roles", roles);
        result.put("matrix", matrix);
        result.put("stats", stats);

        return result;
    }
}
