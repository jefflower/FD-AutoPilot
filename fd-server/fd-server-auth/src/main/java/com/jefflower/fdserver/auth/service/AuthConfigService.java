package com.jefflower.fdserver.auth.service;

import com.jefflower.fdserver.auth.dto.AuthConfigDTO;
import com.jefflower.fdserver.auth.entity.AuthConfig;
import com.jefflower.fdserver.auth.repository.AuthConfigRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthConfigService {

    private final AuthConfigRepository authConfigRepository;

    // ====== 配置 Key 常量 ======
    public static final String KEY_ORG_SYNC_PLATFORM = "org_sync_platform";
    public static final String KEY_OAUTH_ENABLED = "oauth_enabled";
    public static final String KEY_DEFAULT_SYNC_ROLE = "default_sync_role";

    public static final String KEY_DINGTALK_APP_KEY = "dingtalk_app_key";
    public static final String KEY_DINGTALK_APP_SECRET = "dingtalk_app_secret";
    public static final String KEY_DINGTALK_CORP_ID = "dingtalk_corp_id";
    public static final String KEY_DINGTALK_ROOT_DEPT_ID = "dingtalk_root_dept_id";

    public static final String KEY_WECOM_CORP_ID = "wecom_corp_id";
    public static final String KEY_WECOM_AGENT_ID = "wecom_agent_id";
    public static final String KEY_WECOM_SECRET = "wecom_secret";
    public static final String KEY_WECOM_ROOT_DEPT_ID = "wecom_root_dept_id";

    // ====== 基础读写 ======

    public String getValue(String key) {
        return authConfigRepository.findById(key)
                .map(AuthConfig::getConfigValue)
                .orElse(null);
    }

    public String getValue(String key, String defaultValue) {
        return Optional.ofNullable(getValue(key)).orElse(defaultValue);
    }

    @Transactional
    public void setValue(String key, String value, String description, boolean isSecret) {
        AuthConfig config = authConfigRepository.findById(key).orElseGet(() -> {
            AuthConfig c = new AuthConfig();
            c.setConfigKey(key);
            return c;
        });
        config.setConfigValue(value);
        if (description != null) {
            config.setDescription(description);
        }
        config.setIsSecret(isSecret);
        config.setUpdatedAt(LocalDateTime.now());
        authConfigRepository.save(config);
    }

    public void setValue(String key, String value) {
        setValue(key, value, null, false);
    }

    // ====== 聚合读写 ======

    public AuthConfigDTO getOrgSyncConfig() {
        return AuthConfigDTO.builder()
                .orgSyncPlatform(getValue(KEY_ORG_SYNC_PLATFORM, "none"))
                .oauthEnabled("true".equals(getValue(KEY_OAUTH_ENABLED, "false")))
                .defaultSyncRole(getValue(KEY_DEFAULT_SYNC_ROLE, "USER"))
                .dingtalkAppKey(getValue(KEY_DINGTALK_APP_KEY, ""))
                .dingtalkAppSecret(maskSecret(KEY_DINGTALK_APP_SECRET))
                .dingtalkCorpId(getValue(KEY_DINGTALK_CORP_ID, ""))
                .dingtalkRootDeptId(getValue(KEY_DINGTALK_ROOT_DEPT_ID, "1"))
                .wecomCorpId(getValue(KEY_WECOM_CORP_ID, ""))
                .wecomAgentId(getValue(KEY_WECOM_AGENT_ID, ""))
                .wecomSecret(maskSecret(KEY_WECOM_SECRET))
                .wecomRootDeptId(getValue(KEY_WECOM_ROOT_DEPT_ID, "1"))
                .build();
    }

    @Transactional
    public void saveOrgSyncConfig(AuthConfigDTO dto) {
        setValue(KEY_ORG_SYNC_PLATFORM, dto.getOrgSyncPlatform(), "同步平台", false);
        setValue(KEY_OAUTH_ENABLED, String.valueOf(dto.isOauthEnabled()), "OAuth 开关", false);
        setValue(KEY_DEFAULT_SYNC_ROLE, dto.getDefaultSyncRole(), "同步用户默认角色", false);

        // 钉钉配置
        setValue(KEY_DINGTALK_APP_KEY, dto.getDingtalkAppKey(), "钉钉 App Key", false);
        if (dto.getDingtalkAppSecret() != null && !dto.getDingtalkAppSecret().contains("***")) {
            setValue(KEY_DINGTALK_APP_SECRET, dto.getDingtalkAppSecret(), "钉钉 App Secret", true);
        }
        setValue(KEY_DINGTALK_CORP_ID, dto.getDingtalkCorpId(), "钉钉 Corp ID", false);
        setValue(KEY_DINGTALK_ROOT_DEPT_ID, dto.getDingtalkRootDeptId(), "钉钉根部门 ID", false);

        // 企微配置
        setValue(KEY_WECOM_CORP_ID, dto.getWecomCorpId(), "企微 Corp ID", false);
        setValue(KEY_WECOM_AGENT_ID, dto.getWecomAgentId(), "企微 Agent ID", false);
        if (dto.getWecomSecret() != null && !dto.getWecomSecret().contains("***")) {
            setValue(KEY_WECOM_SECRET, dto.getWecomSecret(), "企微 Secret", true);
        }
        setValue(KEY_WECOM_ROOT_DEPT_ID, dto.getWecomRootDeptId(), "企微根部门 ID", false);

        log.info("组织同步配置已保存: platform={}", dto.getOrgSyncPlatform());
    }

    /**
     * 获取原始（未脱敏）值，供内部 Service 调用
     */
    public String getRawValue(String key) {
        return getValue(key);
    }

    private String maskSecret(String key) {
        String raw = getValue(key);
        if (raw == null || raw.isEmpty()) {
            return "";
        }
        if (raw.length() <= 6) {
            return "***";
        }
        return raw.substring(0, 3) + "***" + raw.substring(raw.length() - 3);
    }
}
