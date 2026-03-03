package com.jefflower.fdserver.auth.security;

import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class JwtUtilAppCodeTest {

    private JwtUtil jwtUtil;

    @BeforeEach
    void setUp() {
        jwtUtil = new JwtUtil();
        // 设置足够长度的 secret（至少 32 字节 = 256 位，HMAC-SHA256 要求）
        ReflectionTestUtils.setField(jwtUtil, "jwtSecret", "test-secret-key-for-jwt-at-least-32-bytes-long!");
        ReflectionTestUtils.setField(jwtUtil, "accessTokenMinutes", 30);
    }

    @Test
    void generateAccessToken_withAppCode_containsAppCodeClaim() {
        String token = jwtUtil.generateAccessToken(1L, "testuser", List.of("USER"), "fd-web");

        Claims claims = jwtUtil.parseToken(token);

        assertEquals("testuser", claims.getSubject());
        assertEquals("fd-web", claims.get("appCode", String.class));
        assertEquals(1, ((Number) claims.get("uid")).longValue());
        assertNotNull(claims.getId());
    }

    @Test
    void generateAccessToken_withoutAppCode_noAppCodeClaim() {
        String token = jwtUtil.generateAccessToken(1L, "testuser", List.of("USER"));

        Claims claims = jwtUtil.parseToken(token);

        assertEquals("testuser", claims.getSubject());
        assertNull(claims.get("appCode"));
    }

    @Test
    void generateAccessToken_withNullAppCode_noAppCodeClaim() {
        String token = jwtUtil.generateAccessToken(1L, "testuser", List.of("USER"), null);

        Claims claims = jwtUtil.parseToken(token);

        assertNull(claims.get("appCode"));
    }

    @Test
    void generateAccessToken_withBlankAppCode_noAppCodeClaim() {
        String token = jwtUtil.generateAccessToken(1L, "testuser", List.of("USER"), "  ");

        Claims claims = jwtUtil.parseToken(token);

        assertNull(claims.get("appCode"));
    }

    @Test
    void parseTokenOnce_withAppCode_returnsAppCode() {
        String token = jwtUtil.generateAccessToken(1L, "testuser", List.of("ADMIN"), "fd-api");

        JwtUtil.ParsedToken parsed = jwtUtil.parseTokenOnce(token);

        assertEquals(1L, parsed.userId());
        assertEquals("testuser", parsed.username());
        assertEquals(List.of("ADMIN"), parsed.roles());
        assertEquals("fd-api", parsed.appCode());
        assertNotNull(parsed.jti());
        assertNotNull(parsed.expiration());
    }

    @Test
    void parseTokenOnce_withoutAppCode_appCodeIsNull() {
        String token = jwtUtil.generateAccessToken(1L, "testuser", List.of("USER"));

        JwtUtil.ParsedToken parsed = jwtUtil.parseTokenOnce(token);

        assertEquals(1L, parsed.userId());
        assertEquals("testuser", parsed.username());
        assertEquals(List.of("USER"), parsed.roles());
        assertNull(parsed.appCode());
    }

    @Test
    void generateAccessToken_backwardsCompatible_threeArgVersion() {
        // 确保原有的三参数版本仍然正常工作
        String token = jwtUtil.generateAccessToken(42L, "admin", List.of("SUPER_ADMIN", "ADMIN"));

        assertTrue(jwtUtil.validateToken(token));

        JwtUtil.ParsedToken parsed = jwtUtil.parseTokenOnce(token);
        assertEquals(42L, parsed.userId());
        assertEquals("admin", parsed.username());
        assertEquals(List.of("SUPER_ADMIN", "ADMIN"), parsed.roles());
        assertNull(parsed.appCode());
    }
}
