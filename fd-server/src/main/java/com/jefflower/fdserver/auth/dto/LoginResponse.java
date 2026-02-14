package com.jefflower.fdserver.auth.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LoginResponse {
    /**
     * 兼容旧前端：等于 accessToken
     */
    private String token;

    /**
     * Access Token (JWT)
     */
    private String accessToken;

    /**
     * Refresh Token ID（用于刷新 token pair）
     */
    private String refreshToken;

    /**
     * 兼容旧前端：等于 accessTokenExpireAt
     */
    private Long expireAt;

    /**
     * Access Token 过期时间戳（毫秒）
     */
    private Long accessTokenExpireAt;

    /**
     * Refresh Token 过期时间戳（毫秒）
     */
    private Long refreshTokenExpireAt;

    private UserInfo user;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UserInfo {
        private Long id;
        private String username;

        /**
         * 兼容旧前端：取 roles 列表的第一个
         */
        private String role;

        /**
         * 多角色列表
         */
        private List<String> roles;
    }
}
