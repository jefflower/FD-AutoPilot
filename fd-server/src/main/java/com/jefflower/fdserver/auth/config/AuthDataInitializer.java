package com.jefflower.fdserver.auth.config;

import com.jefflower.fdserver.auth.entity.SysPermission;
import com.jefflower.fdserver.auth.entity.SysRole;
import com.jefflower.fdserver.auth.entity.SysRolePermission;
import com.jefflower.fdserver.auth.entity.SysUserRole;
import com.jefflower.fdserver.auth.repository.SysPermissionRepository;
import com.jefflower.fdserver.auth.repository.SysRolePermissionRepository;
import com.jefflower.fdserver.auth.repository.SysRoleRepository;
import com.jefflower.fdserver.auth.repository.SysUserRoleRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
@Order(1)
public class AuthDataInitializer implements ApplicationRunner {

    private final SysRoleRepository roleRepo;
    private final SysPermissionRepository permRepo;
    private final SysRolePermissionRepository rpRepo;
    private final SysUserRoleRepository urRepo;
    private final JdbcTemplate jdbcTemplate;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (roleRepo.count() == 0) {
            log.info("[AuthInit] Initializing RBAC data...");
            Map<String, SysRole> roles = initRoles();
            Map<String, SysPermission> permissions = initPermissions();
            initRolePermissions(roles, permissions);
            log.info("[AuthInit] RBAC data initialized successfully.");
        } else {
            log.info("[AuthInit] RBAC data already exists, skipping initialization.");
        }

        // 迁移旧用户（从 role 字段到 sys_user_role 表）
        migrateExistingUsers();
    }

    private Map<String, SysRole> initRoles() {
        Map<String, SysRole> map = new HashMap<>();
        map.put("SUPER_ADMIN", roleRepo.save(new SysRole("SUPER_ADMIN", "超级管理员", "拥有所有权限", true)));
        map.put("ADMIN", roleRepo.save(new SysRole("ADMIN", "管理员", "用户管理+系统配置+业务管理", true)));
        map.put("USER", roleRepo.save(new SysRole("USER", "普通用户", "工单操作（翻译、回复）", true)));
        map.put("AUDITOR", roleRepo.save(new SysRole("AUDITOR", "审核员", "工单审核", true)));
        log.info("[AuthInit] Created {} roles", map.size());
        return map;
    }

    private Map<String, SysPermission> initPermissions() {
        Map<String, SysPermission> map = new HashMap<>();
        // auth 模块
        map.put("user:read", permRepo.save(new SysPermission("user:read", "查看用户", "auth")));
        map.put("user:manage", permRepo.save(new SysPermission("user:manage", "管理用户", "auth")));
        map.put("role:read", permRepo.save(new SysPermission("role:read", "查看角色", "auth")));
        map.put("role:manage", permRepo.save(new SysPermission("role:manage", "管理角色", "auth")));
        // ticket 模块
        map.put("ticket:read", permRepo.save(new SysPermission("ticket:read", "查看工单", "ticket")));
        map.put("ticket:translate", permRepo.save(new SysPermission("ticket:translate", "翻译工单", "ticket")));
        map.put("ticket:reply", permRepo.save(new SysPermission("ticket:reply", "回复工单", "ticket")));
        map.put("ticket:audit", permRepo.save(new SysPermission("ticket:audit", "审核工单", "ticket")));
        map.put("ticket:push", permRepo.save(new SysPermission("ticket:push", "推送回复", "ticket")));
        map.put("ticket:manage", permRepo.save(new SysPermission("ticket:manage", "管理工单", "ticket")));
        // system 模块
        map.put("sync:read", permRepo.save(new SysPermission("sync:read", "查看同步", "system")));
        map.put("sync:manage", permRepo.save(new SysPermission("sync:manage", "管理同步", "system")));
        map.put("config:read", permRepo.save(new SysPermission("config:read", "查看配置", "system")));
        map.put("config:manage", permRepo.save(new SysPermission("config:manage", "管理配置", "system")));
        map.put("queue:manage", permRepo.save(new SysPermission("queue:manage", "管理队列", "system")));
        map.put("knowledge:read", permRepo.save(new SysPermission("knowledge:read", "查看知识库", "system")));
        map.put("knowledge:manage", permRepo.save(new SysPermission("knowledge:manage", "管理知识库", "system")));
        map.put("database:query", permRepo.save(new SysPermission("database:query", "数据库查询", "system")));
        log.info("[AuthInit] Created {} permissions", map.size());
        return map;
    }

    private void initRolePermissions(Map<String, SysRole> roles, Map<String, SysPermission> perms) {
        // ADMIN: 除 database:query 外的全部
        SysRole admin = roles.get("ADMIN");
        perms.forEach((code, perm) -> {
            if (!"database:query".equals(code)) {
                rpRepo.save(new SysRolePermission(admin.getId(), perm.getId()));
            }
        });

        // USER: ticket:read, ticket:translate, ticket:reply
        SysRole user = roles.get("USER");
        rpRepo.save(new SysRolePermission(user.getId(), perms.get("ticket:read").getId()));
        rpRepo.save(new SysRolePermission(user.getId(), perms.get("ticket:translate").getId()));
        rpRepo.save(new SysRolePermission(user.getId(), perms.get("ticket:reply").getId()));

        // AUDITOR: ticket:read, ticket:audit, ticket:push
        SysRole auditor = roles.get("AUDITOR");
        rpRepo.save(new SysRolePermission(auditor.getId(), perms.get("ticket:read").getId()));
        rpRepo.save(new SysRolePermission(auditor.getId(), perms.get("ticket:audit").getId()));
        rpRepo.save(new SysRolePermission(auditor.getId(), perms.get("ticket:push").getId()));

        // SUPER_ADMIN: 拥有所有权限
        SysRole superAdmin = roles.get("SUPER_ADMIN");
        perms.forEach((code, perm) -> rpRepo.save(new SysRolePermission(superAdmin.getId(), perm.getId())));

        log.info("[AuthInit] Role-Permission associations created.");
    }

    /**
     * 迁移旧用户：检查 sys_user 表是否还有 role 列，如果有，
     * 将旧 role 字段值映射到 sys_user_role 表。
     * 幂等操作：只迁移还没有 user_role 关联的用户。
     */
    private void migrateExistingUsers() {
        try {
            // 检查 sys_user 表是否有 role 列（兼容新旧版本）
            boolean hasRoleColumn = false;
            try {
                jdbcTemplate.queryForList("SELECT role FROM sys_user LIMIT 1");
                hasRoleColumn = true;
            } catch (Exception e) {
                // role 列不存在，说明已经迁移完成
                log.info("[AuthInit] sys_user.role column not found, migration not needed.");
                return;
            }

            if (!hasRoleColumn) return;

            // 查找没有 user_role 关联的用户
            List<Map<String, Object>> usersWithoutRoles = jdbcTemplate.queryForList(
                "SELECT u.id, u.role FROM sys_user u " +
                "WHERE NOT EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_id = u.id)"
            );

            if (usersWithoutRoles.isEmpty()) {
                log.info("[AuthInit] All users already have role assignments.");
                return;
            }

            for (Map<String, Object> row : usersWithoutRoles) {
                Long userId = ((Number) row.get("ID")).longValue();
                String oldRole = (String) row.get("ROLE");
                if (oldRole == null) oldRole = "USER";

                SysRole role = roleRepo.findByCode(oldRole)
                        .orElseGet(() -> roleRepo.findByCode("USER").orElseThrow());

                if (!urRepo.existsByUserIdAndRoleId(userId, role.getId())) {
                    urRepo.save(new SysUserRole(userId, role.getId()));
                    log.info("[AuthInit] Migrated user {} with role {}", userId, oldRole);
                }
            }

            log.info("[AuthInit] Migrated {} users from legacy role column.", usersWithoutRoles.size());
        } catch (Exception e) {
            log.warn("[AuthInit] User migration encountered an issue: {}", e.getMessage());
        }
    }
}
