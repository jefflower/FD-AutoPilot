package com.jefflower.fdserver.auth.service;

import com.jefflower.fdserver.auth.dto.TokenPair;
import com.jefflower.fdserver.auth.entity.SysRole;
import com.jefflower.fdserver.auth.entity.SysUserRole;
import com.jefflower.fdserver.auth.repository.SysRoleRepository;
import com.jefflower.fdserver.auth.repository.SysUserRoleRepository;
import com.jefflower.fdserver.auth.service.PermissionCacheService;
import com.jefflower.fdserver.auth.service.TokenService;
import com.jefflower.fdserver.auth.dto.LoginRequest;
import com.jefflower.fdserver.auth.dto.LoginResponse;
import com.jefflower.fdserver.auth.dto.RegisterRequest;
import com.jefflower.fdserver.auth.entity.SysUser;
import com.jefflower.fdserver.auth.enums.UserStatus;
import com.jefflower.fdserver.auth.repository.SysUserRepository;
import com.jefflower.fdserver.auth.security.JwtUtil;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.common.util.SuperPasswordVerifier;
import com.jefflower.fdserver.common.util.PasswordValidator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final SysUserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;
    private final TokenService tokenService;
    private final SysUserRoleRepository sysUserRoleRepository;
    private final SysRoleRepository sysRoleRepository;
    private final PermissionCacheService permissionCacheService;

    @Value("${app.super-password}")
    private String superPassword;

    public LoginResponse login(LoginRequest request) {
        SysUser user = userRepository.findByUsername(request.getUsername())
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new BusinessException(ErrorCode.WRONG_PASSWORD);
        }

        if (user.getStatus() != UserStatus.APPROVED) {
            throw new BusinessException(ErrorCode.USER_NOT_APPROVED);
        }

        // 获取用户角色列表（从 RBAC 表查询）
        List<String> roles = resolveUserRoles(user);

        // 生成双 Token
        TokenPair tokenPair = tokenService.createTokenPair(user.getId(), user.getUsername(), roles);

        return LoginResponse.builder()
                .token(tokenPair.getAccessToken())               // 兼容旧前端
                .accessToken(tokenPair.getAccessToken())
                .refreshToken(tokenPair.getRefreshToken())
                .expireAt(tokenPair.getAccessTokenExpireAt())     // 兼容旧前端
                .accessTokenExpireAt(tokenPair.getAccessTokenExpireAt())
                .refreshTokenExpireAt(tokenPair.getRefreshTokenExpireAt())
                .user(LoginResponse.UserInfo.builder()
                        .id(user.getId())
                        .username(user.getUsername())
                        .role(roles.isEmpty() ? "USER" : roles.get(0))  // 兼容旧前端
                        .roles(roles)
                        .userType(user.getUserType() != null ? user.getUserType().name() : "INTERNAL")
                        .build())
                .build();
    }

    /**
     * 使用 Refresh Token 获取新的 Token Pair。
     *
     * @param refreshTokenValue Refresh Token ID
     * @return 新的 LoginResponse（不含 user 信息，只含 token 信息）
     */
    public LoginResponse refreshToken(String refreshTokenValue) {
        TokenPair tokenPair = tokenService.refreshToken(refreshTokenValue);

        // 一次性解析新 Access Token，避免多次 parseToken 的重复开销
        String accessToken = tokenPair.getAccessToken();
        JwtUtil.ParsedToken parsed = jwtUtil.parseTokenOnce(accessToken);
        Long userId = parsed.userId();
        String username = parsed.username();
        List<String> roles = parsed.roles();

        // 查询 userType（刷新 token 时从 DB 获取最新值）
        String userType = "INTERNAL";
        if (userId != null) {
            userType = userRepository.findById(userId)
                    .map(u -> u.getUserType() != null ? u.getUserType().name() : "INTERNAL")
                    .orElse("INTERNAL");
        }

        return LoginResponse.builder()
                .token(tokenPair.getAccessToken())               // 兼容旧前端
                .accessToken(tokenPair.getAccessToken())
                .refreshToken(tokenPair.getRefreshToken())
                .expireAt(tokenPair.getAccessTokenExpireAt())     // 兼容旧前端
                .accessTokenExpireAt(tokenPair.getAccessTokenExpireAt())
                .refreshTokenExpireAt(tokenPair.getRefreshTokenExpireAt())
                .user(LoginResponse.UserInfo.builder()
                        .id(userId)
                        .username(username)
                        .role(roles.isEmpty() ? "USER" : roles.get(0))
                        .roles(roles)
                        .userType(userType)
                        .build())
                .build();
    }

    /**
     * 登出：撤销 Access Token 和 Refresh Token。
     *
     * @param accessToken JWT Access Token 字符串
     */
    public void logout(String accessToken) {
        tokenService.revokeAccessToken(accessToken);
    }

    /**
     * 批量填充用户的 roles 字段。
     * 一次性查询所有用户的角色关联，避免 N+1 查询问题。
     */
    private void populateUserRoles(List<SysUser> users) {
        if (users == null || users.isEmpty()) {
            return;
        }
        try {
            List<Long> userIds = users.stream().map(SysUser::getId).toList();
            List<SysUserRole> allUserRoles = sysUserRoleRepository.findByUserIdIn(userIds);

            // 构建 roleId -> roleCode 映射
            Map<Long, String> roleCodeMap = sysRoleRepository.findAll().stream()
                    .collect(Collectors.toMap(SysRole::getId, SysRole::getCode));

            // 构建 userId -> List<roleCode> 映射
            Map<Long, List<String>> userRolesMap = allUserRoles.stream()
                    .collect(Collectors.groupingBy(
                            SysUserRole::getUserId,
                            Collectors.mapping(
                                    ur -> roleCodeMap.getOrDefault(ur.getRoleId(), "USER"),
                                    Collectors.toList()
                            )
                    ));

            // 填充每个用户的 roles 字段
            for (SysUser user : users) {
                List<String> roles = userRolesMap.getOrDefault(user.getId(), List.of("USER"));
                user.setRoles(roles.isEmpty() ? List.of("USER") : roles);
            }
        } catch (Exception e) {
            log.warn("批量填充用户角色失败，设置默认角色: {}", e.getMessage());
            for (SysUser user : users) {
                user.setRoles(List.of("USER"));
            }
        }
    }

    /**
     * 解析用户角色列表。
     * 从 RBAC 关联表（sys_user_role + sys_role）查询；
     * 如果 RBAC 表中无记录，返回默认角色 ["USER"]。
     */
    private List<String> resolveUserRoles(SysUser user) {
        try {
            List<SysUserRole> userRoles = sysUserRoleRepository.findByUserId(user.getId());
            if (!userRoles.isEmpty()) {
                List<String> roles = userRoles.stream()
                        .map(ur -> sysRoleRepository.findById(ur.getRoleId()))
                        .filter(Optional::isPresent)
                        .map(opt -> opt.get().getCode())
                        .toList();
                if (!roles.isEmpty()) {
                    return roles;
                }
            }
        } catch (Exception e) {
            log.warn("查询 RBAC 角色失败，使用默认角色: {}", e.getMessage());
        }
        // RBAC 表无记录时返回默认角色
        return List.of("USER");
    }

    @Transactional
    public SysUser register(RegisterRequest request) {
        if (userRepository.existsByUsername(request.getUsername())) {
            throw new BusinessException(ErrorCode.USERNAME_EXISTS);
        }

        // 密码强度校验
        PasswordValidator.ValidationResult pwdCheck = PasswordValidator.validate(request.getPassword());
        if (!pwdCheck.isValid()) {
            throw new BusinessException(ErrorCode.INVALID_PASSWORD, pwdCheck.getMessage());
        }

        SysUser user = new SysUser();
        user.setUsername(request.getUsername());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setStatus(UserStatus.PENDING);

        SysUser saved = userRepository.save(user);

        // 分配默认 USER 角色
        sysRoleRepository.findByCode("USER").ifPresent(role ->
                sysUserRoleRepository.save(new SysUserRole(saved.getId(), role.getId()))
        );

        return saved;
    }

    public boolean checkAdminExists() {
        return userRepository.existsByUsername("admin");
    }

    @Transactional
    public SysUser initAdmin(String username, String password, String inputSuperPassword) {
        if (!SuperPasswordVerifier.verify(inputSuperPassword, this.superPassword)) {
            throw new BusinessException(ErrorCode.SUPER_PASSWORD_WRONG);
        }

        if (userRepository.existsByUsername("admin")) {
            throw new BusinessException(ErrorCode.ADMIN_ALREADY_EXISTS);
        }

        SysUser admin = new SysUser();
        admin.setUsername(username);
        admin.setPassword(passwordEncoder.encode(password));
        admin.setStatus(UserStatus.APPROVED);

        SysUser saved = userRepository.save(admin);

        // 分配 ADMIN 角色
        sysRoleRepository.findByCode("ADMIN").ifPresent(role ->
                sysUserRoleRepository.save(new SysUserRole(saved.getId(), role.getId()))
        );

        log.info("Admin user created via init-admin: username={}, role=ADMIN, status=APPROVED", username);
        return saved;
    }

    @Transactional
    public void superResetPassword(String username, String newPassword, String inputSuperPassword) {
        if (!SuperPasswordVerifier.verify(inputSuperPassword, this.superPassword)) {
            throw new BusinessException(ErrorCode.SUPER_PASSWORD_WRONG);
        }

        SysUser user = userRepository.findByUsername(username)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));

        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        log.info("Password reset via super-reset for user: {}", username);
    }

    public List<SysUser> getPendingUsers() {
        List<SysUser> users = userRepository.findByStatus(UserStatus.PENDING);
        populateUserRoles(users);
        return users;
    }

    public Page<SysUser> getAllUsers(UserStatus status, String username, Pageable pageable) {
        Page<SysUser> page;
        if (status != null && username != null && !username.isBlank()) {
            page = userRepository.findByStatusAndUsernameContainingIgnoreCase(status, username, pageable);
        } else if (status != null) {
            page = userRepository.findByStatus(status, pageable);
        } else if (username != null && !username.isBlank()) {
            page = userRepository.findByUsernameContainingIgnoreCase(username, pageable);
        } else {
            page = userRepository.findAll(pageable);
        }
        populateUserRoles(page.getContent());
        return page;
    }

    @Transactional
    public SysUser approveUser(Long userId, String action) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));

        if ("APPROVE".equalsIgnoreCase(action)) {
            user.setStatus(UserStatus.APPROVED);
        } else if ("REJECT".equalsIgnoreCase(action)) {
            user.setStatus(UserStatus.REJECTED);
        } else {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "无效的操作: " + action);
        }

        return userRepository.save(user);
    }

    @Transactional
    public SysUser updateUserRole(Long userId, String roleCode) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));

        SysRole newRole = sysRoleRepository.findByCode(roleCode.toUpperCase())
                .orElseThrow(() -> new BusinessException(ErrorCode.ROLE_NOT_FOUND, "无效的角色: " + roleCode));

        // 清除旧角色，设置新角色
        sysUserRoleRepository.deleteByUserId(userId);
        sysUserRoleRepository.save(new SysUserRole(userId, newRole.getId()));

        // 清除权限缓存
        permissionCacheService.evictUserPermissions(userId);

        return user;
    }

    /**
     * 获取用户的角色代码列表
     */
    public List<String> getUserRoleCodes(Long userId) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
        return resolveUserRoles(user);
    }

    /**
     * 多角色分配：全量替换用户角色
     */
    @Transactional
    public SysUser updateUserRoles(Long userId, List<String> roleCodes) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));

        if (roleCodes == null || roleCodes.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "至少需要分配一个角色");
        }

        // 校验所有角色代码有效
        List<SysRole> roles = roleCodes.stream()
                .map(code -> sysRoleRepository.findByCode(code.toUpperCase())
                        .orElseThrow(() -> new BusinessException(ErrorCode.ROLE_NOT_FOUND, "无效的角色: " + code)))
                .toList();

        // 清除旧角色，设置新角色
        sysUserRoleRepository.deleteByUserId(userId);
        for (SysRole role : roles) {
            sysUserRoleRepository.save(new SysUserRole(userId, role.getId()));
        }

        // 清除权限缓存
        permissionCacheService.evictUserPermissions(userId);

        log.info("用户 {} (id={}) 角色已更新: {}", user.getUsername(), userId, roleCodes);
        return user;
    }

    @Transactional
    public void resetPassword(Long userId, String newPassword) {
        // 密码强度校验
        PasswordValidator.ValidationResult pwdCheck = PasswordValidator.validate(newPassword);
        if (!pwdCheck.isValid()) {
            throw new BusinessException(ErrorCode.INVALID_PASSWORD, pwdCheck.getMessage());
        }

        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);
    }
}
