package com.jefflower.fdserver.auth.service;

import com.jefflower.fdserver.auth.dto.DepartmentDTO;
import com.jefflower.fdserver.auth.dto.ExternalUserDTO;
import com.jefflower.fdserver.auth.dto.OrgSyncResult;
import com.jefflower.fdserver.auth.entity.OrgSyncLog;
import com.jefflower.fdserver.auth.entity.SysDepartment;
import com.jefflower.fdserver.auth.entity.SysUser;
import com.jefflower.fdserver.auth.entity.SysUserRole;
import com.jefflower.fdserver.auth.enums.OrgSyncStatus;
import com.jefflower.fdserver.auth.enums.UserStatus;
import com.jefflower.fdserver.auth.enums.UserType;
import com.jefflower.fdserver.auth.repository.*;
import com.jefflower.fdserver.auth.service.sync.OrgSyncStrategy;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
public class OrgSyncService {

    private final AuthConfigService configService;
    private final Map<String, OrgSyncStrategy> strategyMap;
    private final SysDepartmentRepository departmentRepository;
    private final SysUserRepository userRepository;
    private final SysUserRoleRepository userRoleRepository;
    private final SysRoleRepository roleRepository;
    private final OrgSyncLogRepository syncLogRepository;
    private final PasswordEncoder passwordEncoder;

    public OrgSyncService(AuthConfigService configService,
                          List<OrgSyncStrategy> strategies,
                          SysDepartmentRepository departmentRepository,
                          SysUserRepository userRepository,
                          SysUserRoleRepository userRoleRepository,
                          SysRoleRepository roleRepository,
                          OrgSyncLogRepository syncLogRepository,
                          PasswordEncoder passwordEncoder) {
        this.configService = configService;
        this.strategyMap = strategies.stream()
                .collect(Collectors.toMap(OrgSyncStrategy::getPlatformCode, s -> s));
        this.departmentRepository = departmentRepository;
        this.userRepository = userRepository;
        this.userRoleRepository = userRoleRepository;
        this.roleRepository = roleRepository;
        this.syncLogRepository = syncLogRepository;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * 手动触发组织架构同步
     */
    @Transactional
    public OrgSyncResult syncOrganization(String triggerUsername) {
        // 检查是否有正在进行的同步
        if (syncLogRepository.existsByStatus(OrgSyncStatus.RUNNING)) {
            throw new BusinessException(ErrorCode.ORG_SYNC_IN_PROGRESS);
        }

        String platform = configService.getValue(AuthConfigService.KEY_ORG_SYNC_PLATFORM, "none");
        if ("none".equals(platform)) {
            throw new BusinessException(ErrorCode.ORG_SYNC_PLATFORM_NOT_CONFIGURED);
        }

        OrgSyncStrategy strategy = strategyMap.get(platform);
        if (strategy == null) {
            throw new BusinessException(ErrorCode.ORG_SYNC_PLATFORM_NOT_CONFIGURED, "不支持的平台: " + platform);
        }

        // 创建同步日志
        OrgSyncLog syncLog = new OrgSyncLog();
        syncLog.setPlatform(platform);
        syncLog.setTriggerUser(triggerUsername);
        syncLog.setStartTime(LocalDateTime.now());
        syncLog.setStatus(OrgSyncStatus.RUNNING);
        syncLog = syncLogRepository.save(syncLog);

        long startMs = System.currentTimeMillis();
        int deptsCreated = 0, deptsUpdated = 0;
        int usersCreated = 0, usersUpdated = 0, usersSkipped = 0;

        try {
            // 1. 获取 AccessToken
            String accessToken = strategy.fetchAccessToken(configService);
            log.info("组织同步: 获取 {} AccessToken 成功", platform);

            // 2. 同步部门树
            List<DepartmentDTO> departments = strategy.fetchDepartments(accessToken, configService);
            log.info("组织同步: 获取到 {} 个部门", departments.size());

            // externalId → 本地部门 ID 映射
            Map<String, Long> deptIdMap = new HashMap<>();
            for (DepartmentDTO dept : departments) {
                Optional<SysDepartment> existing = departmentRepository.findByExternalIdAndPlatform(dept.getExternalId(), platform);
                SysDepartment entity;
                if (existing.isPresent()) {
                    entity = existing.get();
                    entity.setName(dept.getName());
                    entity.setSortOrder(dept.getSortOrder());
                    entity.setUpdatedAt(LocalDateTime.now());
                    deptsUpdated++;
                } else {
                    entity = new SysDepartment();
                    entity.setExternalId(dept.getExternalId());
                    entity.setPlatform(platform);
                    entity.setName(dept.getName());
                    entity.setSortOrder(dept.getSortOrder());
                    deptsCreated++;
                }
                // 设置父部门
                if (dept.getParentExternalId() != null && deptIdMap.containsKey(dept.getParentExternalId())) {
                    entity.setParentId(deptIdMap.get(dept.getParentExternalId()));
                }
                entity = departmentRepository.save(entity);
                deptIdMap.put(dept.getExternalId(), entity.getId());
            }

            // 构建 path
            buildDepartmentPaths(deptIdMap.values());

            // 3. 逐部门同步用户
            String defaultRole = configService.getValue(AuthConfigService.KEY_DEFAULT_SYNC_ROLE, "USER");
            Set<String> processedUserIds = new HashSet<>();

            for (DepartmentDTO dept : departments) {
                List<ExternalUserDTO> users = strategy.fetchDepartmentUsers(accessToken, dept.getExternalId());
                Long localDeptId = deptIdMap.get(dept.getExternalId());

                for (ExternalUserDTO exUser : users) {
                    if (processedUserIds.contains(exUser.getExternalUserId())) continue;
                    processedUserIds.add(exUser.getExternalUserId());

                    if (!exUser.isActive()) {
                        usersSkipped++;
                        continue;
                    }

                    Optional<SysUser> existingUser = findExistingUser(platform, exUser.getExternalUserId());
                    if (existingUser.isPresent()) {
                        // 更新
                        SysUser user = existingUser.get();
                        user.setDisplayName(exUser.getName());
                        user.setAvatar(exUser.getAvatar());
                        user.setMobile(exUser.getMobile());
                        user.setEmail(exUser.getEmail());
                        user.setDepartmentId(localDeptId);
                        user.setExternalSyncAt(LocalDateTime.now());
                        userRepository.save(user);
                        usersUpdated++;
                    } else {
                        // 创建新用户
                        SysUser newUser = createSyncedUser(platform, exUser, localDeptId, defaultRole);
                        userRepository.save(newUser);
                        assignDefaultRole(newUser.getId(), defaultRole);
                        usersCreated++;
                    }
                }
            }

            // 更新日志
            syncLog.setStatus(OrgSyncStatus.SUCCESS);
            syncLog.setEndTime(LocalDateTime.now());
            syncLog.setDepartmentsCreated(deptsCreated);
            syncLog.setDepartmentsUpdated(deptsUpdated);
            syncLog.setUsersCreated(usersCreated);
            syncLog.setUsersUpdated(usersUpdated);
            syncLog.setUsersSkipped(usersSkipped);
            syncLogRepository.save(syncLog);

            log.info("组织同步完成: 部门 +{}/~{}, 用户 +{}/~{}/跳过{}", deptsCreated, deptsUpdated, usersCreated, usersUpdated, usersSkipped);

        } catch (Exception e) {
            syncLog.setStatus(OrgSyncStatus.FAILED);
            syncLog.setEndTime(LocalDateTime.now());
            syncLog.setErrorMessage(e.getMessage());
            syncLogRepository.save(syncLog);
            log.error("组织同步失败: {}", e.getMessage(), e);
            throw new BusinessException(ErrorCode.ORG_SYNC_FAILED, e.getMessage());
        }

        return OrgSyncResult.builder()
                .platform(platform)
                .departmentsCreated(deptsCreated)
                .departmentsUpdated(deptsUpdated)
                .usersCreated(usersCreated)
                .usersUpdated(usersUpdated)
                .usersSkipped(usersSkipped)
                .durationMs(System.currentTimeMillis() - startMs)
                .build();
    }

    public List<SysDepartment> getDepartmentTree() {
        return departmentRepository.findAll();
    }

    public List<OrgSyncLog> getSyncLogs() {
        return syncLogRepository.findTop20ByOrderByCreatedAtDesc();
    }

    public boolean testConnection() {
        String platform = configService.getValue(AuthConfigService.KEY_ORG_SYNC_PLATFORM, "none");
        if ("none".equals(platform)) return false;
        OrgSyncStrategy strategy = strategyMap.get(platform);
        if (strategy == null) return false;
        return strategy.testConnection(configService);
    }

    // ========== 内部方法 ==========

    private Optional<SysUser> findExistingUser(String platform, String externalUserId) {
        return "dingtalk".equals(platform)
                ? userRepository.findByDingtalkUserId(externalUserId)
                : userRepository.findByWecomUserId(externalUserId);
    }

    private SysUser createSyncedUser(String platform, ExternalUserDTO exUser, Long deptId, String defaultRole) {
        SysUser user = new SysUser();

        // username: 优先手机号 → 邮箱 → 外部ID
        String username = exUser.getMobile() != null && !exUser.getMobile().isEmpty() ? exUser.getMobile()
                : exUser.getEmail() != null && !exUser.getEmail().isEmpty() ? exUser.getEmail()
                : exUser.getExternalUserId();

        // 处理用户名冲突
        String finalUsername = username;
        int suffix = 1;
        while (userRepository.existsByUsername(finalUsername)) {
            finalUsername = username + "_" + suffix++;
        }

        user.setUsername(finalUsername);
        user.setPassword(passwordEncoder.encode(UUID.randomUUID().toString().substring(0, 12)));
        user.setStatus(UserStatus.APPROVED);
        user.setUserType(UserType.INTERNAL);
        user.setDisplayName(exUser.getName());
        user.setAvatar(exUser.getAvatar());
        user.setMobile(exUser.getMobile());
        user.setEmail(exUser.getEmail());
        user.setDepartmentId(deptId);
        user.setExternalSyncAt(LocalDateTime.now());

        if ("dingtalk".equals(platform)) {
            user.setDingtalkUserId(exUser.getExternalUserId());
        } else {
            user.setWecomUserId(exUser.getExternalUserId());
        }

        return user;
    }

    private void assignDefaultRole(Long userId, String roleCode) {
        roleRepository.findByCode(roleCode).ifPresent(role ->
                userRoleRepository.save(new SysUserRole(userId, role.getId()))
        );
    }

    private void buildDepartmentPaths(Collection<Long> deptIds) {
        Map<Long, SysDepartment> deptMap = new HashMap<>();
        for (Long id : deptIds) {
            departmentRepository.findById(id).ifPresent(d -> deptMap.put(id, d));
        }

        for (SysDepartment dept : deptMap.values()) {
            StringBuilder pathBuilder = new StringBuilder();
            SysDepartment current = dept;
            List<Long> pathIds = new ArrayList<>();
            while (current != null) {
                pathIds.add(0, current.getId());
                current = current.getParentId() != null ? deptMap.get(current.getParentId()) : null;
            }
            for (Long pid : pathIds) {
                pathBuilder.append("/").append(pid);
            }
            dept.setPath(pathBuilder.toString());
            departmentRepository.save(dept);
        }
    }
}
