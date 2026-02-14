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
        Date now = new Date();
        Date expiry = new Date(now.getTime() + accessTokenMinutes * 60 * 1000L);
        String jti = UUID.randomUUID().toString();

        return Jwts.builder()
                .subject(username)
                .id(jti)
                .claim("uid", userId)
                .claim("roles", roles)
                .issuedAt(now)
                .expiration(expiry)
                .signWith(getSigningKey())
                .compact();
    }

    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(token)
                .getPayload();
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
}
