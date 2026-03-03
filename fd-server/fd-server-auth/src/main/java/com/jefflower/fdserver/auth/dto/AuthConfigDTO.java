package com.jefflower.fdserver.auth.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AuthConfigDTO {
    // 同步平台: dingtalk / wecom / none
    private String orgSyncPlatform;

    // OAuth 开关
    private boolean oauthEnabled;

    // 同步用户默认角色
    private String defaultSyncRole;

    // 钉钉配置
    private String dingtalkAppKey;
    private String dingtalkAppSecret;
    private String dingtalkCorpId;
    private String dingtalkRootDeptId;

    // 企微配置
    private String wecomCorpId;
    private String wecomAgentId;
    private String wecomSecret;
    private String wecomRootDeptId;
}
