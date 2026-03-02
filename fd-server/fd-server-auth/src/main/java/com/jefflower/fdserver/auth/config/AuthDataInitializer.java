package com.jefflower.fdserver.auth.config;

import com.jefflower.fdserver.auth.entity.*;
import com.jefflower.fdserver.auth.enums.UserStatus;
import com.jefflower.fdserver.auth.repository.*;
import com.jefflower.fdserver.auth.service.ModulePermissionDefinition;
import com.jefflower.fdserver.auth.repository.SysApplicationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
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
    private final SysUserRepository userRepo;
    private final SysModuleRepository moduleRepo;
    private final SysApplicationRepository applicationRepo;
    private final PasswordEncoder passwordEncoder;
    private final JdbcTemplate jdbcTemplate;
    private final List<ModulePermissionDefinition> moduleDefinitions;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        ensureBaseRoles();
        ensureDefaultAdmin();
        ensureN8nServiceAccount();
        syncModulesAndPermissions();
        ensureSuperAdminHasAllPermissions();
        ensureDefaultApplications();
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
     * 确保默认 admin 用户存在（admin/admin123, SUPER_ADMIN 角色, APPROVED 状态）
     */
    private void ensureDefaultAdmin() {
        if (userRepo.existsByUsername("admin")) {
            return;
        }

        SysUser admin = new SysUser();
        admin.setUsername("admin");
        admin.setPassword(passwordEncoder.encode("admin123"));
        admin.setStatus(UserStatus.APPROVED);
        SysUser saved = userRepo.save(admin);

        // 分配 SUPER_ADMIN 角色
        roleRepo.findByCode("SUPER_ADMIN").ifPresent(role ->
                urRepo.save(new SysUserRole(saved.getId(), role.getId()))
        );

        log.info("[AuthInit] 创建默认管理员: admin (SUPER_ADMIN)");
    }

    /**
     * 确保 n8n 服务账号存在（n8n-service/n8n-service, ADMIN 角色, APPROVED 状态）
     * 用于 n8n 工作流通过 REST API 调用 fd-server
     */
    private void ensureN8nServiceAccount() {
        if (userRepo.existsByUsername("n8n-service")) {
            return;
        }

        SysUser n8nUser = new SysUser();
        n8nUser.setUsername("n8n-service");
        n8nUser.setPassword(passwordEncoder.encode("n8n-service"));
        n8nUser.setStatus(UserStatus.APPROVED);
        SysUser saved = userRepo.save(n8nUser);

        // 分配 ADMIN 角色（具有所有业务权限）
        roleRepo.findByCode("ADMIN").ifPresent(role ->
                urRepo.save(new SysUserRole(saved.getId(), role.getId()))
        );

        log.info("[AuthInit] 创建 n8n 服务账号: n8n-service (ADMIN)");
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
            Map<String, String> permissionTypes = def.getPermissionTypes();
            Map<String, List<String>> defaultAssignments = def.getDefaultRoleAssignments();

            for (Map.Entry<String, String> entry : permissions.entrySet()) {
                String permCode = entry.getKey();
                String permName = entry.getValue();
                String permType = permissionTypes.getOrDefault(permCode, null);

                // 检查权限是否已存在
                var existingPerm = permRepo.findByCode(permCode).orElse(null);
                if (existingPerm != null) {
                    // 权限已存在，检查 module 归属是否需要迁移
                    if (!def.getModuleCode().equals(existingPerm.getModule())) {
                        String oldModule = existingPerm.getModule();
                        existingPerm.setModule(def.getModuleCode());
                        permRepo.save(existingPerm);
                        log.info("[AuthInit] 迁移权限 {} 模块归属: {} → {}", permCode, oldModule, def.getModuleCode());
                    }
                    // 如果 type 为 null，则从 PermissionDefinition 更新
                    if (existingPerm.getType() == null && permType != null) {
                        existingPerm.setType(permType);
                        existingPerm.setBuiltIn(true);
                        permRepo.save(existingPerm);
                    }
                    continue;
                }

                // 创建新权限
                SysPermission perm = new SysPermission(permCode, permName, def.getModuleCode());
                if (permType != null) {
                    perm.setType(permType);
                }
                perm.setBuiltIn(true);
                final SysPermission savedPerm = permRepo.save(perm);
                newPermissions++;
                log.info("[AuthInit] 创建权限: {} ({})", permCode, def.getModuleCode());

                // 分配给默认角色
                List<String> roleCodes = defaultAssignments.getOrDefault(permCode, List.of());
                for (String roleCode : roleCodes) {
                    roleRepo.findByCode(roleCode).ifPresent(role -> {
                        if (!rpRepo.existsByRoleIdAndPermissionId(role.getId(), savedPerm.getId())) {
                            rpRepo.save(new SysRolePermission(role.getId(), savedPerm.getId()));
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
     * 确保默认应用存在
     */
    private void ensureDefaultApplications() {
        if (!applicationRepo.existsByCode("fd-web")) {
            applicationRepo.save(new SysApplication("fd-web", "FD Web", "FD-AutoPilot Web 应用", true));
            log.info("[AuthInit] 创建默认应用: fd-web");
        }
    }

    /**
     * 迁移旧用户（从 role 字段到 sys_user_role 表）
     */
    private void migrateExistingUsers() {
        try {
            // 使用 information_schema 检查列是否存在（避免直接 SELECT 在 PostgreSQL 中导致事务 abort）
            Integer columnCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.columns " +
                "WHERE table_schema = current_schema() AND table_name = 'sys_user' AND column_name = 'role'",
                Integer.class
            );
            if (columnCount == null || columnCount == 0) {
                return; // role 列不存在，无需迁移
            }

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
