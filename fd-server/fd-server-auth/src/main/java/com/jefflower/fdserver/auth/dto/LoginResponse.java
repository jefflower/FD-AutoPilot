package com.jefflower.fdserver.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Schema(description = "登录响应")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LoginResponse {
    @Schema(description = "兼容旧前端：等于 accessToken")
    private String token;

    @Schema(description = "Access Token (JWT)")
    private String accessToken;

    @Schema(description = "Refresh Token ID（用于刷新 token pair）")
    private String refreshToken;

    @Schema(description = "兼容旧前端：等于 accessTokenExpireAt")
    private Long expireAt;

    @Schema(description = "Access Token 过期时间戳（毫秒）")
    private Long accessTokenExpireAt;

    @Schema(description = "Refresh Token 过期时间戳（毫秒）")
    private Long refreshTokenExpireAt;

    @Schema(description = "用户信息")
    private UserInfo user;

    @Schema(description = "用户基本信息")
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UserInfo {
        @Schema(description = "用户 ID")
        private Long id;

        @Schema(description = "用户名")
        private String username;

        @Schema(description = "兼容旧前端：取 roles 列表的第一个")
        private String role;

        @Schema(description = "多角色列表")
        private List<String> roles;

        @Schema(description = "用户类型（INTERNAL=B端/员工, EXTERNAL=C端/客户）")
        private String userType;
    }
}
