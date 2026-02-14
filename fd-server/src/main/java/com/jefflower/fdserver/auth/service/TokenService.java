package com.jefflower.fdserver.auth.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.auth.dto.TokenPair;
import com.jefflower.fdserver.auth.security.JwtUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 双 Token 生命周期管理服务。
 * <p>
 * Access Token: 短期 JWT，包含用户信息和角色，由 JwtUtil 生成。
 * Refresh Token: 长期随机 ID，存储在 Redis（降级到内存），用于换取新的 Token Pair。
 * <p>
 * 支持 Refresh Token Rotation：每次刷新都会作废旧 Refresh Token 并生成新的。
 */
@Slf4j
@Service
public class TokenService {

    private final JwtUtil jwtUtil;
    private final StringRedisTemplate stringRedisTemplate;
    private final TokenBlacklistService tokenBlacklistService;
    private final ObjectMapper objectMapper;

    @Value("${jwt.refresh-token-days:7}")
    private int refreshTokenDays;

    private static final String REFRESH_KEY_PREFIX = "auth:refresh:";

    /**
     * 降级用本地 Refresh Token 存储：key = refreshTokenId, value = RefreshTokenData JSON
     */
    private final ConcurrentHashMap<String, LocalRefreshToken> localRefreshTokens = new ConcurrentHashMap<>();

    public TokenService(JwtUtil jwtUtil,
                        StringRedisTemplate stringRedisTemplate,
                        TokenBlacklistService tokenBlacklistService) {
        this.jwtUtil = jwtUtil;
        this.stringRedisTemplate = stringRedisTemplate;
        this.tokenBlacklistService = tokenBlacklistService;
        this.objectMapper = new ObjectMapper();
    }

    /**
     * 创建双 Token 对
     *
     * @param userId   用户 ID
     * @param username 用户名
     * @param roles    角色列表（如 ["ADMIN", "USER"]）
     * @return TokenPair 包含 accessToken, refreshToken, 过期时间
     */
    public TokenPair createTokenPair(Long userId, String username, List<String> roles) {
        // 生成 Access Token (JWT)
        String accessToken = jwtUtil.generateAccessToken(userId, username, roles);
        Date accessExpiration = jwtUtil.getExpiration(accessToken);

        // 生成 Refresh Token ID (随机 UUID)
        String refreshTokenId = UUID.randomUUID().toString();
        long refreshTtlMillis = refreshTokenDays * 24 * 3600 * 1000L;
        long refreshExpireAt = System.currentTimeMillis() + refreshTtlMillis;

        // 存储 Refresh Token 数据到 Redis（降级到本地）
        RefreshTokenData data = new RefreshTokenData(userId, username, roles);
        storeRefreshToken(refreshTokenId, data, refreshTtlMillis);

        return TokenPair.builder()
                .accessToken(accessToken)
                .refreshToken(refreshTokenId)
                .accessTokenExpireAt(accessExpiration.getTime())
                .refreshTokenExpireAt(refreshExpireAt)
                .build();
    }

    /**
     * 刷新 Token（Refresh Token Rotation）。
     * 旧的 Refresh Token 会被立即作废，返回全新的 Token Pair。
     *
     * @param refreshTokenId 当前 Refresh Token ID
     * @return 新的 TokenPair
     * @throws RuntimeException 如果 Refresh Token 无效或已过期
     */
    public TokenPair refreshToken(String refreshTokenId) {
        // 从存储中读取并删除旧 Refresh Token（原子操作保证 Rotation 安全）
        RefreshTokenData data = loadAndDeleteRefreshToken(refreshTokenId);
        if (data == null) {
            throw new RuntimeException("INVALID_REFRESH_TOKEN");
        }

        // 使用旧 Refresh Token 中的用户信息创建全新的 Token Pair
        return createTokenPair(data.userId(), data.username(), data.roles());
    }

    /**
     * 撤销 Access Token（加入黑名单，在其剩余有效期内拒绝认证）
     *
     * @param accessToken JWT Access Token 字符串
     */
    public void revokeAccessToken(String accessToken) {
        try {
            String jti = jwtUtil.getJti(accessToken);
            Date expiration = jwtUtil.getExpiration(accessToken);
            long ttlMillis = expiration.getTime() - System.currentTimeMillis();
            if (ttlMillis > 0) {
                tokenBlacklistService.addToBlacklist(jti, ttlMillis);
                log.info("Access Token 已撤销: jti={}", jti);
            }
        } catch (Exception e) {
            log.warn("撤销 Access Token 失败: {}", e.getMessage());
        }
    }

    /**
     * 撤销 Refresh Token（从存储中删除）
     *
     * @param refreshTokenId Refresh Token ID
     */
    public void revokeRefreshToken(String refreshTokenId) {
        deleteRefreshToken(refreshTokenId);
        log.info("Refresh Token 已撤销: id={}", refreshTokenId);
    }

    // ========== 内部存储方法 ==========

    private void storeRefreshToken(String refreshTokenId, RefreshTokenData data, long ttlMillis) {
        try {
            String key = REFRESH_KEY_PREFIX + refreshTokenId;
            String json = objectMapper.writeValueAsString(data);
            long ttlSeconds = Math.max(ttlMillis / 1000, 1);
            stringRedisTemplate.opsForValue().set(key, json, ttlSeconds, TimeUnit.SECONDS);
            log.debug("Refresh Token 已存储到 Redis: id={}", refreshTokenId);
        } catch (Exception e) {
            log.warn("Redis 不可用，Refresh Token 降级到本地内存: {}", e.getMessage());
            long expireAt = System.currentTimeMillis() + ttlMillis;
            localRefreshTokens.put(refreshTokenId, new LocalRefreshToken(data, expireAt));
        }
    }

    private RefreshTokenData loadAndDeleteRefreshToken(String refreshTokenId) {
        // 先尝试 Redis
        try {
            String key = REFRESH_KEY_PREFIX + refreshTokenId;
            String json = stringRedisTemplate.opsForValue().getAndDelete(key);
            if (json != null) {
                return objectMapper.readValue(json, RefreshTokenData.class);
            }
            // Redis 中不存在，检查本地降级存储
            return loadAndDeleteLocal(refreshTokenId);
        } catch (JsonProcessingException e) {
            log.error("Refresh Token JSON 解析失败: {}", e.getMessage());
            return null;
        } catch (Exception e) {
            log.warn("Redis 不可用，从本地内存查询 Refresh Token: {}", e.getMessage());
            return loadAndDeleteLocal(refreshTokenId);
        }
    }

    private RefreshTokenData loadAndDeleteLocal(String refreshTokenId) {
        LocalRefreshToken local = localRefreshTokens.remove(refreshTokenId);
        if (local == null) {
            return null;
        }
        if (System.currentTimeMillis() > local.expireAt()) {
            // 已过期
            return null;
        }
        return local.data();
    }

    private void deleteRefreshToken(String refreshTokenId) {
        try {
            String key = REFRESH_KEY_PREFIX + refreshTokenId;
            stringRedisTemplate.delete(key);
        } catch (Exception e) {
            log.warn("Redis 不可用，从本地内存删除 Refresh Token: {}", e.getMessage());
        }
        // 同时清理本地存储（可能降级时存入了本地）
        localRefreshTokens.remove(refreshTokenId);
    }

    // ========== 内部数据结构 ==========

    /**
     * Refresh Token 存储的用户数据
     */
    public record RefreshTokenData(Long userId, String username, List<String> roles) {
    }

    /**
     * 本地降级存储结构
     */
    private record LocalRefreshToken(RefreshTokenData data, long expireAt) {
    }
}
