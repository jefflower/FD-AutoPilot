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

import java.util.List;
import java.util.Optional;

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

    @Value("${app.super-password:hnlx}")
    private String superPassword;

    public LoginResponse login(LoginRequest request) {
        SysUser user = userRepository.findByUsername(request.getUsername())
                .orElseThrow(() -> new RuntimeException("USER_NOT_FOUND"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new RuntimeException("WRONG_PASSWORD");
        }

        if (user.getStatus() != UserStatus.APPROVED) {
            throw new RuntimeException("USER_NOT_APPROVED");
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

        // 从新 Access Token 中解析用户信息
        String accessToken = tokenPair.getAccessToken();
        Long userId = jwtUtil.getUserId(accessToken);
        String username = jwtUtil.getUsername(accessToken);
        List<String> roles = jwtUtil.getRoles(accessToken);

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
            throw new RuntimeException("用户名已存在");
        }

        // 密码强度校验
        PasswordValidator.ValidationResult pwdCheck = PasswordValidator.validate(request.getPassword());
        if (!pwdCheck.isValid()) {
            throw new RuntimeException(pwdCheck.getMessage());
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
            throw new RuntimeException("INVALID_SUPER_PASSWORD");
        }

        if (userRepository.existsByUsername("admin")) {
            throw new RuntimeException("ADMIN_ALREADY_EXISTS");
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
            throw new RuntimeException("INVALID_SUPER_PASSWORD");
        }

        SysUser user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("USER_NOT_FOUND"));

        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        log.info("Password reset via super-reset for user: {}", username);
    }

    public List<SysUser> getPendingUsers() {
        return userRepository.findByStatus(UserStatus.PENDING);
    }

    public Page<SysUser> getAllUsers(UserStatus status, String username, Pageable pageable) {
        if (status != null && username != null && !username.isBlank()) {
            return userRepository.findByStatusAndUsernameContainingIgnoreCase(status, username, pageable);
        } else if (status != null) {
            return userRepository.findByStatus(status, pageable);
        } else if (username != null && !username.isBlank()) {
            return userRepository.findByUsernameContainingIgnoreCase(username, pageable);
        }
        return userRepository.findAll(pageable);
    }

    @Transactional
    public SysUser approveUser(Long userId, String action) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("用户不存在"));

        if ("APPROVE".equalsIgnoreCase(action)) {
            user.setStatus(UserStatus.APPROVED);
        } else if ("REJECT".equalsIgnoreCase(action)) {
            user.setStatus(UserStatus.REJECTED);
        } else {
            throw new RuntimeException("无效的操作: " + action);
        }

        return userRepository.save(user);
    }

    @Transactional
    public SysUser updateUserRole(Long userId, String roleCode) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("用户不存在"));

        SysRole newRole = sysRoleRepository.findByCode(roleCode.toUpperCase())
                .orElseThrow(() -> new RuntimeException("无效的角色: " + roleCode));

        // 清除旧角色，设置新角色
        sysUserRoleRepository.deleteByUserId(userId);
        sysUserRoleRepository.save(new SysUserRole(userId, newRole.getId()));

        // 清除权限缓存
        permissionCacheService.evictUserPermissions(userId);

        return user;
    }

    @Transactional
    public void resetPassword(Long userId, String newPassword) {
        // 密码强度校验
        PasswordValidator.ValidationResult pwdCheck = PasswordValidator.validate(newPassword);
        if (!pwdCheck.isValid()) {
            throw new RuntimeException(pwdCheck.getMessage());
        }

        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("用户不存在"));
        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);
    }
}
