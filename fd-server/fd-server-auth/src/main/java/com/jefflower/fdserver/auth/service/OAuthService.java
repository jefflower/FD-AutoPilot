package com.jefflower.fdserver.auth.service;

import com.jefflower.fdserver.auth.dto.LoginResponse;
import com.jefflower.fdserver.auth.dto.OAuthUserInfo;
import com.jefflower.fdserver.auth.dto.TokenPair;
import com.jefflower.fdserver.auth.entity.SysUser;
import com.jefflower.fdserver.auth.entity.SysUserRole;
import com.jefflower.fdserver.auth.enums.UserStatus;
import com.jefflower.fdserver.auth.enums.UserType;
import com.jefflower.fdserver.auth.repository.SysRoleRepository;
import com.jefflower.fdserver.auth.repository.SysUserRepository;
import com.jefflower.fdserver.auth.repository.SysUserRoleRepository;
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
public class OAuthService {

    private final AuthConfigService configService;
    private final Map<String, OrgSyncStrategy> strategyMap;
    private final SysUserRepository userRepository;
    private final SysUserRoleRepository userRoleRepository;
    private final SysRoleRepository roleRepository;
    private final TokenService tokenService;
    private final PasswordEncoder passwordEncoder;

    public OAuthService(AuthConfigService configService,
                        List<OrgSyncStrategy> strategies,
                        SysUserRepository userRepository,
                        SysUserRoleRepository userRoleRepository,
                        SysRoleRepository roleRepository,
                        TokenService tokenService,
                        PasswordEncoder passwordEncoder) {
        this.configService = configService;
        this.strategyMap = strategies.stream()
                .collect(Collectors.toMap(OrgSyncStrategy::getPlatformCode, s -> s));
        this.userRepository = userRepository;
        this.userRoleRepository = userRoleRepository;
        this.roleRepository = roleRepository;
        this.tokenService = tokenService;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * OAuth 登录：authCode → 匹配/创建用户 → 签发 JWT
     */
    @Transactional
    public LoginResponse oauthLogin(String platform, String authCode) {
        // 检查 OAuth 是否启用
        if (!"true".equals(configService.getValue(AuthConfigService.KEY_OAUTH_ENABLED, "false"))) {
            throw new BusinessException(ErrorCode.OAUTH_DISABLED);
        }

        OrgSyncStrategy strategy = strategyMap.get(platform);
        if (strategy == null) {
            throw new BusinessException(ErrorCode.ORG_SYNC_PLATFORM_NOT_CONFIGURED, "不支持的 OAuth 平台: " + platform);
        }

        // 通过 authCode 获取外部用户信息
        OAuthUserInfo oauthUser = strategy.resolveOAuthUser(authCode, configService);
        log.info("OAuth 登录: platform={}, externalUserId={}, name={}", platform, oauthUser.getExternalUserId(), oauthUser.getName());

        // 匹配本地用户
        Optional<SysUser> existingUser = "dingtalk".equals(platform)
                ? userRepository.findByDingtalkUserId(oauthUser.getExternalUserId())
                : userRepository.findByWecomUserId(oauthUser.getExternalUserId());

        SysUser user;
        if (existingUser.isPresent()) {
            user = existingUser.get();
            // 更新用户信息
            user.setDisplayName(oauthUser.getName());
            user.setAvatar(oauthUser.getAvatar());
            user.setMobile(oauthUser.getMobile());
            user.setEmail(oauthUser.getEmail());
            user.setExternalSyncAt(LocalDateTime.now());
            userRepository.save(user);
        } else {
            // 自动创建用户
            user = createOAuthUser(platform, oauthUser);
        }

        // 签发 JWT
        List<String> roles = resolveUserRoles(user.getId());
        TokenPair tokenPair = tokenService.createTokenPair(user.getId(), user.getUsername(), roles);

        return LoginResponse.builder()
                .token(tokenPair.getAccessToken())
                .accessToken(tokenPair.getAccessToken())
                .refreshToken(tokenPair.getRefreshToken())
                .expireAt(tokenPair.getAccessTokenExpireAt())
                .accessTokenExpireAt(tokenPair.getAccessTokenExpireAt())
                .refreshTokenExpireAt(tokenPair.getRefreshTokenExpireAt())
                .user(LoginResponse.UserInfo.builder()
                        .id(user.getId())
                        .username(user.getUsername())
                        .role(roles.isEmpty() ? "USER" : roles.get(0))
                        .roles(roles)
                        .userType(user.getUserType() != null ? user.getUserType().name() : "INTERNAL")
                        .build())
                .build();
    }

    /**
     * 获取 OAuth 状态（是否启用）
     */
    public Map<String, Object> getOAuthStatus() {
        boolean enabled = "true".equals(configService.getValue(AuthConfigService.KEY_OAUTH_ENABLED, "false"));
        String platform = configService.getValue(AuthConfigService.KEY_ORG_SYNC_PLATFORM, "none");
        Map<String, Object> result = new HashMap<>();
        result.put("enabled", enabled);
        result.put("platform", platform);
        return result;
    }

    /**
     * 获取 OAuth 授权 URL
     */
    public String getOAuthUrl(String platform, String redirectUri) {
        OrgSyncStrategy strategy = strategyMap.get(platform);
        if (strategy == null) {
            throw new BusinessException(ErrorCode.ORG_SYNC_PLATFORM_NOT_CONFIGURED, "不支持的 OAuth 平台: " + platform);
        }
        return strategy.buildOAuthUrl(redirectUri, configService);
    }

    // ========== 内部方法 ==========

    private SysUser createOAuthUser(String platform, OAuthUserInfo oauthUser) {
        SysUser user = new SysUser();

        String username = oauthUser.getMobile() != null && !oauthUser.getMobile().isEmpty() ? oauthUser.getMobile()
                : oauthUser.getEmail() != null && !oauthUser.getEmail().isEmpty() ? oauthUser.getEmail()
                : oauthUser.getExternalUserId();

        String finalUsername = username;
        int suffix = 1;
        while (userRepository.existsByUsername(finalUsername)) {
            finalUsername = username + "_" + suffix++;
        }

        user.setUsername(finalUsername);
        user.setPassword(passwordEncoder.encode(UUID.randomUUID().toString().substring(0, 12)));
        user.setStatus(UserStatus.APPROVED);
        user.setUserType(UserType.INTERNAL);
        user.setDisplayName(oauthUser.getName());
        user.setAvatar(oauthUser.getAvatar());
        user.setMobile(oauthUser.getMobile());
        user.setEmail(oauthUser.getEmail());
        user.setExternalSyncAt(LocalDateTime.now());

        if ("dingtalk".equals(platform)) {
            user.setDingtalkUserId(oauthUser.getExternalUserId());
        } else {
            user.setWecomUserId(oauthUser.getExternalUserId());
        }

        SysUser saved = userRepository.save(user);

        // 分配默认角色
        String defaultRole = configService.getValue(AuthConfigService.KEY_DEFAULT_SYNC_ROLE, "USER");
        roleRepository.findByCode(defaultRole).ifPresent(role ->
                userRoleRepository.save(new SysUserRole(saved.getId(), role.getId()))
        );

        log.info("OAuth 自动创建用户: username={}, platform={}, externalId={}", finalUsername, platform, oauthUser.getExternalUserId());
        return saved;
    }

    private List<String> resolveUserRoles(Long userId) {
        List<SysUserRole> userRoles = userRoleRepository.findByUserId(userId);
        if (userRoles.isEmpty()) return List.of("USER");

        return userRoles.stream()
                .map(ur -> roleRepository.findById(ur.getRoleId()))
                .filter(Optional::isPresent)
                .map(opt -> opt.get().getCode())
                .toList();
    }
}
