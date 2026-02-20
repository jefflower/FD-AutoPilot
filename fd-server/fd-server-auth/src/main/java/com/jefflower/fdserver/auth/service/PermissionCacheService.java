package com.jefflower.fdserver.auth.service;

import com.jefflower.fdserver.auth.repository.SysRolePermissionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 权限缓存服务：Redis + 本地 ConcurrentHashMap 双级降级缓存。
 * <p>
 * 读取优先级：Redis &rarr; 本地缓存 &rarr; 数据库查询（兜底）。
 * <p>
 * Redis 不可用时自动降级到本地缓存，确保在无 Redis 环境（如测试、开发）下正常运行。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PermissionCacheService {

    private final SysRolePermissionRepository rolePermissionRepository;
    private final StringRedisTemplate redisTemplate;

    private static final String CACHE_PREFIX = "auth:permissions:";
    private static final long CACHE_TTL_MINUTES = 5;

    /**
     * 降级用本地缓存：userId -> CachedPermissions
     */
    private final ConcurrentHashMap<Long, CachedPermissions> localCache = new ConcurrentHashMap<>();

    /**
     * 获取用户权限集合。
     * <p>
     * 优先从 Redis 读取，Redis 不可用或无缓存时降级到本地缓存，
     * 本地缓存也未命中或已过期则查询数据库并回填缓存。
     *
     * @param userId 用户 ID
     * @return 该用户拥有的权限代码集合（不可变视图）
     */
    public Set<String> getUserPermissions(Long userId) {
        // 1. 尝试 Redis
        try {
            String key = CACHE_PREFIX + userId;
            Set<String> cached = redisTemplate.opsForSet().members(key);
            if (cached != null && !cached.isEmpty()) {
                return cached;
            }
        } catch (Exception e) {
            log.debug("Redis 读取失败，降级到本地缓存: {}", e.getMessage());
        }

        // 2. 尝试本地缓存
        CachedPermissions local = localCache.get(userId);
        if (local != null && !local.isExpired()) {
            return local.permissions();
        }

        // 3. 数据库查询（兜底）
        List<String> perms = rolePermissionRepository.findPermissionCodesByUserId(userId);
        Set<String> permSet = new HashSet<>(perms);

        // 4. 写回缓存
        cachePermissions(userId, permSet);

        return permSet;
    }

    /**
     * 清除指定用户的权限缓存。
     * <p>
     * 应在以下场景调用：
     * <ul>
     *   <li>用户角色变更</li>
     *   <li>用户被禁用/删除</li>
     * </ul>
     *
     * @param userId 用户 ID
     */
    public void evictUserPermissions(Long userId) {
        localCache.remove(userId);
        try {
            redisTemplate.delete(CACHE_PREFIX + userId);
        } catch (Exception e) {
            log.debug("Redis 缓存清除失败: {}", e.getMessage());
        }
        log.debug("已清除用户 userId={} 的权限缓存", userId);
    }

    /**
     * 清除角色下所有用户的权限缓存。
     * <p>
     * 应在角色权限变更时调用，影响该角色下的所有用户。
     *
     * @param roleId          角色 ID
     * @param affectedUserIds 受影响的用户 ID 列表
     */
    public void evictByRoleId(Long roleId, List<Long> affectedUserIds) {
        affectedUserIds.forEach(this::evictUserPermissions);
        log.debug("已清除角色 roleId={} 下 {} 个用户的权限缓存", roleId, affectedUserIds.size());
    }

    /**
     * 将权限集合写入 Redis 和本地缓存。
     */
    private void cachePermissions(Long userId, Set<String> permissions) {
        // 写本地缓存
        long expiresAt = System.currentTimeMillis() + CACHE_TTL_MINUTES * 60 * 1000;
        localCache.put(userId, new CachedPermissions(permissions, expiresAt));

        // 写 Redis
        try {
            String key = CACHE_PREFIX + userId;
            if (!permissions.isEmpty()) {
                redisTemplate.opsForSet().add(key, permissions.toArray(String[]::new));
                redisTemplate.expire(key, Duration.ofMinutes(CACHE_TTL_MINUTES));
            }
        } catch (Exception e) {
            log.debug("Redis 写入失败: {}", e.getMessage());
        }
    }

    /**
     * 缓存条目：权限集合 + 过期时间戳
     */
    private record CachedPermissions(Set<String> permissions, long expiresAt) {
        boolean isExpired() {
            return System.currentTimeMillis() > expiresAt;
        }
    }
}
