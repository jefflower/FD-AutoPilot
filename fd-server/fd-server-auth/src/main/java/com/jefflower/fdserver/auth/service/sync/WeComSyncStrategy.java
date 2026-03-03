package com.jefflower.fdserver.auth.service.sync;

import com.jefflower.fdserver.auth.dto.DepartmentDTO;
import com.jefflower.fdserver.auth.dto.ExternalUserDTO;
import com.jefflower.fdserver.auth.dto.OAuthUserInfo;
import com.jefflower.fdserver.auth.service.AuthConfigService;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
public class WeComSyncStrategy implements OrgSyncStrategy {

    private static final String BASE_URL = "https://qyapi.weixin.qq.com/cgi-bin";
    private final RestTemplate restTemplate = new RestTemplate();
    private final Map<String, CachedToken> tokenCache = new ConcurrentHashMap<>();

    @Override
    public String getPlatformCode() {
        return "wecom";
    }

    @Override
    @SuppressWarnings("unchecked")
    public String fetchAccessToken(AuthConfigService configService) {
        String corpId = configService.getRawValue(AuthConfigService.KEY_WECOM_CORP_ID);
        String secret = configService.getRawValue(AuthConfigService.KEY_WECOM_SECRET);
        if (corpId == null || corpId.isEmpty() || secret == null || secret.isEmpty()) {
            throw new BusinessException(ErrorCode.ORG_SYNC_PLATFORM_NOT_CONFIGURED, "企微 CorpID/Secret 未配置");
        }

        String cacheKey = "wecom:" + corpId;
        CachedToken cached = tokenCache.get(cacheKey);
        if (cached != null && cached.expireAt > System.currentTimeMillis()) {
            return cached.token;
        }

        String url = BASE_URL + "/gettoken?corpid=" + corpId + "&corpsecret=" + secret;
        Map<String, Object> resp = restTemplate.getForObject(url, Map.class);
        if (resp == null || !Integer.valueOf(0).equals(resp.get("errcode"))) {
            String errMsg = resp != null ? String.valueOf(resp.get("errmsg")) : "无响应";
            throw new BusinessException(ErrorCode.ORG_SYNC_FAILED, "企微获取 Token 失败: " + errMsg);
        }

        String token = (String) resp.get("access_token");
        tokenCache.put(cacheKey, new CachedToken(token, System.currentTimeMillis() + 115 * 60 * 1000L));
        return token;
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<DepartmentDTO> fetchDepartments(String accessToken, AuthConfigService configService) {
        String url = BASE_URL + "/department/list?access_token=" + accessToken;
        Map<String, Object> resp = restTemplate.getForObject(url, Map.class);
        if (resp == null || !Integer.valueOf(0).equals(resp.get("errcode"))) {
            throw new BusinessException(ErrorCode.ORG_SYNC_FAILED, "企微获取部门列表失败");
        }

        List<Map<String, Object>> deptList = (List<Map<String, Object>>) resp.get("department");
        if (deptList == null) return List.of();

        List<DepartmentDTO> result = new ArrayList<>();
        for (int i = 0; i < deptList.size(); i++) {
            Map<String, Object> dept = deptList.get(i);
            String externalId = String.valueOf(dept.get("id"));
            Object parentIdObj = dept.get("parentid");
            String parentExternalId = parentIdObj != null ? String.valueOf(parentIdObj) : null;
            // 企微根部门的 parentid 为 0，标记为 null
            if ("0".equals(parentExternalId)) {
                parentExternalId = null;
            }
            result.add(DepartmentDTO.builder()
                    .externalId(externalId)
                    .name((String) dept.get("name"))
                    .parentExternalId(parentExternalId)
                    .sortOrder(dept.get("order") != null ? ((Number) dept.get("order")).intValue() : i)
                    .build());
        }
        return result;
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<ExternalUserDTO> fetchDepartmentUsers(String accessToken, String deptId) {
        String url = BASE_URL + "/user/list?access_token=" + accessToken + "&department_id=" + deptId;
        Map<String, Object> resp = restTemplate.getForObject(url, Map.class);
        if (resp == null || !Integer.valueOf(0).equals(resp.get("errcode"))) {
            log.warn("企微获取部门用户失败 deptId={}: {}", deptId, resp);
            return List.of();
        }

        List<Map<String, Object>> userList = (List<Map<String, Object>>) resp.get("userlist");
        if (userList == null) return List.of();

        List<ExternalUserDTO> result = new ArrayList<>();
        for (Map<String, Object> u : userList) {
            // 企微 status: 1=已激活, 2=已禁用, 4=未激活, 5=退出
            Integer status = u.get("status") != null ? ((Number) u.get("status")).intValue() : 0;
            boolean active = status == 1;
            result.add(ExternalUserDTO.builder()
                    .externalUserId((String) u.get("userid"))
                    .name((String) u.get("name"))
                    .mobile((String) u.get("mobile"))
                    .email((String) u.get("email"))
                    .avatar((String) u.get("avatar"))
                    .departmentExternalId(deptId)
                    .active(active)
                    .build());
        }
        return result;
    }

    @Override
    @SuppressWarnings("unchecked")
    public OAuthUserInfo resolveOAuthUser(String authCode, AuthConfigService configService) {
        String accessToken = fetchAccessToken(configService);

        // Step 1: authCode → userId
        String url1 = BASE_URL + "/auth/getuserinfo?access_token=" + accessToken + "&code=" + authCode;
        Map<String, Object> resp1 = restTemplate.getForObject(url1, Map.class);
        if (resp1 == null || !Integer.valueOf(0).equals(resp1.get("errcode"))) {
            throw new BusinessException(ErrorCode.OAUTH_FAILED, "企微 OAuth 获取用户信息失败");
        }

        String userId = (String) resp1.get("UserId");
        if (userId == null || userId.isEmpty()) {
            throw new BusinessException(ErrorCode.OAUTH_FAILED, "企微 OAuth 未返回 UserId（可能是外部联系人）");
        }

        // Step 2: userId → 用户详情
        String url2 = BASE_URL + "/user/get?access_token=" + accessToken + "&userid=" + userId;
        Map<String, Object> resp2 = restTemplate.getForObject(url2, Map.class);
        if (resp2 == null || !Integer.valueOf(0).equals(resp2.get("errcode"))) {
            throw new BusinessException(ErrorCode.OAUTH_FAILED, "企微获取用户详情失败");
        }

        return OAuthUserInfo.builder()
                .externalUserId(userId)
                .name((String) resp2.get("name"))
                .mobile((String) resp2.get("mobile"))
                .email((String) resp2.get("email"))
                .avatar((String) resp2.get("avatar"))
                .build();
    }

    @Override
    public String buildOAuthUrl(String redirectUri, AuthConfigService configService) {
        String corpId = configService.getRawValue(AuthConfigService.KEY_WECOM_CORP_ID);
        String agentId = configService.getRawValue(AuthConfigService.KEY_WECOM_AGENT_ID);
        String encodedRedirect = URLEncoder.encode(redirectUri, StandardCharsets.UTF_8);
        return "https://open.weixin.qq.com/connect/oauth2/authorize?"
                + "appid=" + corpId
                + "&redirect_uri=" + encodedRedirect
                + "&response_type=code"
                + "&scope=snsapi_privateinfo"
                + "&state=wecom"
                + "&agentid=" + agentId
                + "#wechat_redirect";
    }

    @Override
    public boolean testConnection(AuthConfigService configService) {
        try {
            fetchAccessToken(configService);
            return true;
        } catch (Exception e) {
            log.warn("企微连接测试失败: {}", e.getMessage());
            return false;
        }
    }

    private record CachedToken(String token, long expireAt) {}
}
