package com.jefflower.fdserver.auth.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;
import java.util.UUID;

@Component
public class JwtUtil {

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Value("${jwt.access-token-minutes:30}")
    private int accessTokenMinutes;

    private SecretKey getSigningKey() {
        return Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 生成 Access Token（新版，多角色 + jti）。
     *
     * @param userId   用户 ID
     * @param username 用户名
     * @param roles    角色列表（如 ["ADMIN", "USER"]）
     * @return JWT 字符串
     */
    public String generateAccessToken(Long userId, String username, List<String> roles) {
        return generateAccessToken(userId, username, roles, null);
    }

    /**
     * 生成 Access Token（支持可选 appCode claim）。
     *
     * @param userId   用户 ID
     * @param username 用户名
     * @param roles    角色列表（如 ["ADMIN", "USER"]）
     * @param appCode  应用标识（可选，如 "fd-web"），为 null 时不写入 claim
     * @return JWT 字符串
     */
    public String generateAccessToken(Long userId, String username, List<String> roles, String appCode) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + accessTokenMinutes * 60 * 1000L);
        String jti = UUID.randomUUID().toString();

        var builder = Jwts.builder()
                .subject(username)
                .id(jti)
                .claim("uid", userId)
                .claim("roles", roles);

        if (appCode != null && !appCode.isBlank()) {
            builder.claim("appCode", appCode);
        }

        return builder
                .issuedAt(now)
                .expiration(expiry)
                .signWith(getSigningKey())
                .compact();
    }

    /**
     * 解析 token 为 Claims（每次调用都会重新解析和验证签名）。
     * <p>
     * 如果需要从同一个 token 中提取多个字段，推荐使用 {@link #parseTokenOnce(String)}
     * 返回 {@link ParsedToken} 结构体，避免重复解析开销。
     */
    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    /**
     * 一次性解析 token 并提取所有常用字段，避免多次调用 parseToken 的重复开销。
     * <p>
     * 适用于 JwtAuthenticationFilter、AuthService.refreshToken 等需要同时获取
     * userId、username、roles、jti 的场景。
     *
     * @param token JWT 字符串
     * @return ParsedToken 包含所有解析后的字段
     */
    @SuppressWarnings("unchecked")
    public ParsedToken parseTokenOnce(String token) {
        Claims claims = parseToken(token);

        // userId: 兼容新版 "uid" 和旧版 "userId"
        Long userId = null;
        Object uid = claims.get("uid");
        if (uid instanceof Number) {
            userId = ((Number) uid).longValue();
        } else {
            Object userIdClaim = claims.get("userId");
            if (userIdClaim instanceof Number) {
                userId = ((Number) userIdClaim).longValue();
            }
        }

        // username
        String username = claims.getSubject();

        // jti
        String jti = claims.getId();

        // roles: 兼容新版 "roles" (List) 和旧版 "role" (String)
        List<String> roles;
        Object rolesObj = claims.get("roles");
        if (rolesObj instanceof List<?>) {
            roles = (List<String>) rolesObj;
        } else {
            String role = claims.get("role", String.class);
            roles = (role != null) ? List.of(role) : List.of();
        }

        // expiration
        Date expiration = claims.getExpiration();

        // appCode (可选字段)
        String appCode = claims.get("appCode", String.class);

        return new ParsedToken(userId, username, jti, roles, expiration, appCode);
    }

    public boolean validateToken(String token) {
        try {
            Claims claims = parseToken(token);
            return claims.getExpiration().after(new Date());
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 从 token 提取用户 ID。
     * 兼容新版 "uid" 和旧版 "userId" 两种 claim 名。
     */
    public Long getUserId(String token) {
        Claims claims = parseToken(token);
        // 新版 token 使用 "uid"
        Object uid = claims.get("uid");
        if (uid instanceof Number) {
            return ((Number) uid).longValue();
        }
        // 兼容旧版 token 使用 "userId"
        Object userId = claims.get("userId");
        if (userId instanceof Number) {
            return ((Number) userId).longValue();
        }
        return null;
    }

    public String getUsername(String token) {
        return parseToken(token).getSubject();
    }

    /**
     * 从 token 提取 JTI（JWT ID）。
     *
     * @return jti 字符串，旧版 token 可能返回 null
     */
    public String getJti(String token) {
        return parseToken(token).getId();
    }

    /**
     * 从 token 提取角色列表（新版多角色）。
     *
     * @return 角色字符串列表
     */
    @SuppressWarnings("unchecked")
    public List<String> getRoles(String token) {
        Claims claims = parseToken(token);
        // 新版 token 使用 "roles" (List)
        Object roles = claims.get("roles");
        if (roles instanceof List<?>) {
            return (List<String>) roles;
        }
        // 兼容旧版 token 使用 "role" (String)
        String role = claims.get("role", String.class);
        if (role != null) {
            return List.of(role);
        }
        return List.of();
    }

    /**
     * 从 token 提取过期时间。
     */
    public Date getExpiration(String token) {
        return parseToken(token).getExpiration();
    }

    /**
     * Access Token 有效期（毫秒）。
     */
    public long getAccessTokenExpirationMillis() {
        return accessTokenMinutes * 60 * 1000L;
    }

    /**
     * 一次性解析 token 后的结果结构体。
     * 包含所有常用字段，避免多次解析同一个 token。
     *
     * @param userId     用户 ID（可能为 null，兼容旧版 token）
     * @param username   用户名
     * @param jti        JWT ID（可能为 null，旧版 token 无此字段）
     * @param roles      角色列表
     * @param expiration 过期时间
     * @param appCode    应用标识（可选，为 null 表示未指定）
     */
    public record ParsedToken(
            Long userId,
            String username,
            String jti,
            List<String> roles,
            Date expiration,
            String appCode
    ) {}
}
