package com.jefflower.fdserver.auth.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Token 黑名单服务。
 * 已撤销的 Access Token 的 jti 会被加入黑名单，在其原始过期时间内拒绝认证。
 * Redis 不可用时自动降级到本地 ConcurrentHashMap。
 */
@Slf4j
@Service
public class TokenBlacklistService {

    private final StringRedisTemplate stringRedisTemplate;

    /**
     * 降级用本地黑名单：key = jti, value = 过期时间戳(毫秒)
     */
    private final ConcurrentHashMap<String, Long> localBlacklist = new ConcurrentHashMap<>();

    private static final String BLACKLIST_KEY_PREFIX = "auth:blacklist:";

    public TokenBlacklistService(StringRedisTemplate stringRedisTemplate) {
        this.stringRedisTemplate = stringRedisTemplate;
    }

    /**
     * 将 jti 加入黑名单
     *
     * @param jti       JWT ID
     * @param ttlMillis 剩余有效期（毫秒），过期后自动移除
     */
    public void addToBlacklist(String jti, long ttlMillis) {
        if (jti == null || jti.isBlank()) {
            return;
        }
        try {
            String key = BLACKLIST_KEY_PREFIX + jti;
            long ttlSeconds = Math.max(ttlMillis / 1000, 1);
            stringRedisTemplate.opsForValue().set(key, "1", ttlSeconds, TimeUnit.SECONDS);
            log.debug("Token jti={} 已加入 Redis 黑名单, TTL={}s", jti, ttlSeconds);
        } catch (Exception e) {
            log.warn("Redis 不可用，Token 黑名单降级到本地内存: {}", e.getMessage());
            localBlacklist.put(jti, System.currentTimeMillis() + ttlMillis);
        }
    }

    /**
     * 检查 jti 是否在黑名单中
     *
     * @param jti JWT ID
     * @return true 表示已被撤销
     */
    public boolean isBlacklisted(String jti) {
        if (jti == null || jti.isBlank()) {
            return false;
        }
        try {
            String key = BLACKLIST_KEY_PREFIX + jti;
            Boolean exists = stringRedisTemplate.hasKey(key);
            return Boolean.TRUE.equals(exists);
        } catch (Exception e) {
            log.warn("Redis 不可用，从本地内存查询黑名单: {}", e.getMessage());
            return isLocalBlacklisted(jti);
        }
    }

    /**
     * 本地降级黑名单查询，同时清理过期条目
     */
    private boolean isLocalBlacklisted(String jti) {
        Long expiry = localBlacklist.get(jti);
        if (expiry == null) {
            return false;
        }
        if (System.currentTimeMillis() > expiry) {
            localBlacklist.remove(jti);
            return false;
        }
        // 顺便清理其他过期条目（限量避免性能问题）
        cleanupLocalBlacklist();
        return true;
    }

    /**
     * 清理本地黑名单中已过期的条目，最多清理 100 条
     */
    private void cleanupLocalBlacklist() {
        long now = System.currentTimeMillis();
        int cleaned = 0;
        Iterator<Map.Entry<String, Long>> it = localBlacklist.entrySet().iterator();
        while (it.hasNext() && cleaned < 100) {
            Map.Entry<String, Long> entry = it.next();
            if (now > entry.getValue()) {
                it.remove();
                cleaned++;
            }
        }
        if (cleaned > 0) {
            log.debug("清理本地黑名单过期条目: {} 条", cleaned);
        }
    }
}
