package com.jefflower.fdserver.auth.config;

import com.jefflower.fdserver.auth.entity.*;
import com.jefflower.fdserver.auth.repository.*;
import com.jefflower.fdserver.auth.service.ModulePermissionDefinition;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

/**
 * RBAC 数据增量同步初始化器。
 * <p>
 * 每次启动时扫描所有 {@link ModulePermissionDefinition} 实现，
 * 增量创建模块、权限和角色-权限关联，不删除已有数据。
 */
@Slf4j
@Component
@RequiredArgsConstructor
@Order(1)
public class AuthDataInitializer implements ApplicationRunner {

    private final SysRoleRepository roleRepo;
    private final SysPermissionRepository permRepo;
    private final SysRolePermissionRepository rpRepo;
    private final SysUserRoleRepository urRepo;
    private final SysModuleRepository moduleRepo;
    private final JdbcTemplate jdbcTemplate;
    private final List<ModulePermissionDefinition> moduleDefinitions;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        ensureBaseRoles();
        syncModulesAndPermissions();
        ensureSuperAdminHasAllPermissions();
        migrateExistingUsers();
    }

    /**
     * 确保 4 个基础角色存在
     */
    private void ensureBaseRoles() {
        ensureRole("SUPER_ADMIN", "超级管理员", "拥有所有权限");
        ensureRole("ADMIN", "管理员", "用户管理+系统配置+业务管理");
        ensureRole("USER", "普通用户", "工单操作（翻译、回复）");
        ensureRole("AUDITOR", "审核员", "工单审核");
    }

    private void ensureRole(String code, String name, String description) {
        if (!roleRepo.existsByCode(code)) {
            roleRepo.save(new SysRole(code, name, description, true));
            log.info("[AuthInit] 创建角色: {}", code);
        }
    }

    /**
     * 扫描所有 ModulePermissionDefinition，增量同步模块和权限
     */
    private void syncModulesAndPermissions() {
        int newModules = 0, newPermissions = 0, newAssignments = 0;

        for (ModulePermissionDefinition def : moduleDefinitions) {
            // 1. 确保模块存在
            if (!moduleRepo.existsByCode(def.getModuleCode())) {
                moduleRepo.save(new SysModule(
                        def.getModuleCode(), def.getModuleName(), def.getModuleDescription(),
                        def.getModuleIcon(), def.getModuleRoutePath(), def.getModuleSortOrder(), true));
                newModules++;
                log.info("[AuthInit] 创建模块: {}", def.getModuleCode());
            }

            // 2. 增量同步权限
            Map<String, String> permissions = def.getPermissions();
            Map<String, List<String>> defaultAssignments = def.getDefaultRoleAssignments();

            for (Map.Entry<String, String> entry : permissions.entrySet()) {
                String permCode = entry.getKey();
                String permName = entry.getValue();

                if (permRepo.existsByCode(permCode)) {
                    continue; // 已存在，跳过
                }

                // 创建新权限
                SysPermission perm = permRepo.save(new SysPermission(permCode, permName, def.getModuleCode()));
                newPermissions++;
                log.info("[AuthInit] 创建权限: {} ({})", permCode, def.getModuleCode());

                // 分配给默认角色
                List<String> roleCodes = defaultAssignments.getOrDefault(permCode, List.of());
                for (String roleCode : roleCodes) {
                    roleRepo.findByCode(roleCode).ifPresent(role -> {
                        if (!rpRepo.existsByRoleIdAndPermissionId(role.getId(), perm.getId())) {
                            rpRepo.save(new SysRolePermission(role.getId(), perm.getId()));
                        }
                    });
                }
                newAssignments += roleCodes.size();
            }
        }

        if (newModules > 0 || newPermissions > 0) {
            log.info("[AuthInit] 增量同步完成: 新增 {} 个模块, {} 个权限, {} 个角色分配",
                    newModules, newPermissions, newAssignments);
        } else {
            log.info("[AuthInit] 模块和权限已是最新，无需同步。");
        }
    }

    /**
     * 确保 SUPER_ADMIN 拥有所有权限
     */
    private void ensureSuperAdminHasAllPermissions() {
        roleRepo.findByCode("SUPER_ADMIN").ifPresent(superAdmin -> {
            List<SysPermission> allPerms = permRepo.findAll();
            int added = 0;
            for (SysPermission perm : allPerms) {
                if (!rpRepo.existsByRoleIdAndPermissionId(superAdmin.getId(), perm.getId())) {
                    rpRepo.save(new SysRolePermission(superAdmin.getId(), perm.getId()));
                    added++;
                }
            }
            if (added > 0) {
                log.info("[AuthInit] SUPER_ADMIN 补充 {} 个权限", added);
            }
        });
    }

    /**
     * 迁移旧用户（从 role 字段到 sys_user_role 表）
     */
    private void migrateExistingUsers() {
        try {
            boolean hasRoleColumn = false;
            try {
                jdbcTemplate.queryForList("SELECT role FROM sys_user LIMIT 1");
                hasRoleColumn = true;
            } catch (Exception e) {
                return;
            }

            if (!hasRoleColumn) return;

            List<Map<String, Object>> usersWithoutRoles = jdbcTemplate.queryForList(
                "SELECT u.id, u.role FROM sys_user u " +
                "WHERE NOT EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_id = u.id)"
            );

            if (usersWithoutRoles.isEmpty()) return;

            for (Map<String, Object> row : usersWithoutRoles) {
                Long userId = ((Number) row.get("ID")).longValue();
                String oldRole = (String) row.get("ROLE");
                if (oldRole == null) oldRole = "USER";

                SysRole role = roleRepo.findByCode(oldRole)
                        .orElseGet(() -> roleRepo.findByCode("USER").orElseThrow());

                if (!urRepo.existsByUserIdAndRoleId(userId, role.getId())) {
                    urRepo.save(new SysUserRole(userId, role.getId()));
                    log.info("[AuthInit] 迁移用户 {} 角色 {}", userId, oldRole);
                }
            }

            log.info("[AuthInit] 迁移 {} 个旧用户完成", usersWithoutRoles.size());
        } catch (Exception e) {
            log.warn("[AuthInit] 用户迁移异常: {}", e.getMessage());
        }
    }
}
