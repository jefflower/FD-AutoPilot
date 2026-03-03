package com.jefflower.fdserver.auth.service.sync;

import com.jefflower.fdserver.auth.dto.DepartmentDTO;
import com.jefflower.fdserver.auth.dto.ExternalUserDTO;
import com.jefflower.fdserver.auth.dto.OAuthUserInfo;
import com.jefflower.fdserver.auth.service.AuthConfigService;

import java.util.List;

/**
 * 组织架构同步策略接口（钉钉 / 企微）。
 */
public interface OrgSyncStrategy {

    /** 平台代码: dingtalk / wecom */
    String getPlatformCode();

    /** 获取平台 Access Token */
    String fetchAccessToken(AuthConfigService configService);

    /** 递归获取所有部门 */
    List<DepartmentDTO> fetchDepartments(String accessToken, AuthConfigService configService);

    /** 获取某部门下的用户列表 */
    List<ExternalUserDTO> fetchDepartmentUsers(String accessToken, String deptId);

    /** OAuth 授权码换取用户信息 */
    OAuthUserInfo resolveOAuthUser(String authCode, AuthConfigService configService);

    /** 生成 OAuth 授权 URL */
    String buildOAuthUrl(String redirectUri, AuthConfigService configService);

    /** 测试连接（尝试获取 AccessToken） */
    boolean testConnection(AuthConfigService configService);
}
