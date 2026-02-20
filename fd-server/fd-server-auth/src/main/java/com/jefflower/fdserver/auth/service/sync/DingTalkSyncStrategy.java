package com.jefflower.fdserver.auth.service.sync;

import com.jefflower.fdserver.auth.dto.DepartmentDTO;
import com.jefflower.fdserver.auth.dto.ExternalUserDTO;
import com.jefflower.fdserver.auth.dto.OAuthUserInfo;
import com.jefflower.fdserver.auth.service.AuthConfigService;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
public class DingTalkSyncStrategy implements OrgSyncStrategy {

    private static final String BASE_URL = "https://oapi.dingtalk.com";
    private final RestTemplate restTemplate = new RestTemplate();

    // AccessToken 缓存（有效期 2h，提前 5min 过期）
    private final Map<String, CachedToken> tokenCache = new ConcurrentHashMap<>();

    @Override
    public String getPlatformCode() {
        return "dingtalk";
    }

    @Override
    public String fetchAccessToken(AuthConfigService configService) {
        String appKey = configService.getRawValue(AuthConfigService.KEY_DINGTALK_APP_KEY);
        String appSecret = configService.getRawValue(AuthConfigService.KEY_DINGTALK_APP_SECRET);
        if (appKey == null || appKey.isEmpty() || appSecret == null || appSecret.isEmpty()) {
            throw new BusinessException(ErrorCode.ORG_SYNC_PLATFORM_NOT_CONFIGURED, "钉钉 AppKey/AppSecret 未配置");
        }

        String cacheKey = "dingtalk:" + appKey;
        CachedToken cached = tokenCache.get(cacheKey);
        if (cached != null && cached.expireAt > System.currentTimeMillis()) {
            return cached.token;
        }

        String url = BASE_URL + "/gettoken?appkey=" + appKey + "&appsecret=" + appSecret;
        @SuppressWarnings("unchecked")
        Map<String, Object> resp = restTemplate.getForObject(url, Map.class);
        if (resp == null || !Integer.valueOf(0).equals(resp.get("errcode"))) {
            String errMsg = resp != null ? String.valueOf(resp.get("errmsg")) : "无响应";
            throw new BusinessException(ErrorCode.ORG_SYNC_FAILED, "钉钉获取 Token 失败: " + errMsg);
        }

        String token = (String) resp.get("access_token");
        tokenCache.put(cacheKey, new CachedToken(token, System.currentTimeMillis() + 115 * 60 * 1000L));
        return token;
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<DepartmentDTO> fetchDepartments(String accessToken, AuthConfigService configService) {
        String rootDeptId = configService.getValue(AuthConfigService.KEY_DINGTALK_ROOT_DEPT_ID, "1");
        List<DepartmentDTO> result = new ArrayList<>();
        fetchDepartmentsRecursive(accessToken, rootDeptId, null, result);
        return result;
    }

    @SuppressWarnings("unchecked")
    private void fetchDepartmentsRecursive(String accessToken, String deptId, String parentExternalId, List<DepartmentDTO> result) {
        String url = BASE_URL + "/topapi/v2/department/listsub?access_token=" + accessToken;
        Map<String, Object> body = Map.of("dept_id", Long.parseLong(deptId));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

        Map<String, Object> resp = restTemplate.postForObject(url, entity, Map.class);
        if (resp == null || !Integer.valueOf(0).equals(resp.get("errcode"))) {
            log.warn("钉钉获取子部门失败 deptId={}: {}", deptId, resp);
            return;
        }

        List<Map<String, Object>> deptList = (List<Map<String, Object>>) resp.get("result");
        if (deptList == null) return;

        for (int i = 0; i < deptList.size(); i++) {
            Map<String, Object> dept = deptList.get(i);
            String externalId = String.valueOf(dept.get("dept_id"));
            DepartmentDTO dto = DepartmentDTO.builder()
                    .externalId(externalId)
                    .name((String) dept.get("name"))
                    .parentExternalId(parentExternalId)
                    .sortOrder(i)
                    .build();
            result.add(dto);
            // 递归子部门
            fetchDepartmentsRecursive(accessToken, externalId, externalId, result);
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<ExternalUserDTO> fetchDepartmentUsers(String accessToken, String deptId) {
        List<ExternalUserDTO> result = new ArrayList<>();
        long cursor = 0;
        boolean hasMore = true;

        while (hasMore) {
            String url = BASE_URL + "/topapi/v2/user/list?access_token=" + accessToken;
            Map<String, Object> body = new HashMap<>();
            body.put("dept_id", Long.parseLong(deptId));
            body.put("cursor", cursor);
            body.put("size", 100);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

            Map<String, Object> resp = restTemplate.postForObject(url, entity, Map.class);
            if (resp == null || !Integer.valueOf(0).equals(resp.get("errcode"))) {
                log.warn("钉钉获取部门用户失败 deptId={}: {}", deptId, resp);
                break;
            }

            Map<String, Object> pageResult = (Map<String, Object>) resp.get("result");
            if (pageResult == null) break;

            List<Map<String, Object>> userList = (List<Map<String, Object>>) pageResult.get("list");
            if (userList != null) {
                for (Map<String, Object> u : userList) {
                    boolean active = Boolean.TRUE.equals(u.get("active"));
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
            }

            hasMore = Boolean.TRUE.equals(pageResult.get("has_more"));
            if (hasMore && pageResult.get("next_cursor") != null) {
                cursor = ((Number) pageResult.get("next_cursor")).longValue();
            } else {
                hasMore = false;
            }
        }
        return result;
    }

    @Override
    @SuppressWarnings("unchecked")
    public OAuthUserInfo resolveOAuthUser(String authCode, AuthConfigService configService) {
        String accessToken = fetchAccessToken(configService);

        // Step 1: authCode → userId
        String url1 = BASE_URL + "/topapi/v2/user/getuserinfo?access_token=" + accessToken;
        Map<String, Object> body1 = Map.of("code", authCode);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        Map<String, Object> resp1 = restTemplate.postForObject(url1, new HttpEntity<>(body1, headers), Map.class);
        if (resp1 == null || !Integer.valueOf(0).equals(resp1.get("errcode"))) {
            throw new BusinessException(ErrorCode.OAUTH_FAILED, "钉钉 OAuth 获取用户信息失败");
        }

        Map<String, Object> userResult = (Map<String, Object>) resp1.get("result");
        String userId = (String) userResult.get("userid");
        if (userId == null || userId.isEmpty()) {
            throw new BusinessException(ErrorCode.OAUTH_FAILED, "钉钉 OAuth 未返回 userId");
        }

        // Step 2: userId → 用户详情
        String url2 = BASE_URL + "/topapi/v2/user/get?access_token=" + accessToken;
        Map<String, Object> body2 = Map.of("userid", userId);
        Map<String, Object> resp2 = restTemplate.postForObject(url2, new HttpEntity<>(body2, headers), Map.class);
        if (resp2 == null || !Integer.valueOf(0).equals(resp2.get("errcode"))) {
            throw new BusinessException(ErrorCode.OAUTH_FAILED, "钉钉获取用户详情失败");
        }

        Map<String, Object> detail = (Map<String, Object>) resp2.get("result");
        return OAuthUserInfo.builder()
                .externalUserId(userId)
                .name((String) detail.get("name"))
                .mobile((String) detail.get("mobile"))
                .email((String) detail.get("email"))
                .avatar((String) detail.get("avatar"))
                .build();
    }

    @Override
    public String buildOAuthUrl(String redirectUri, AuthConfigService configService) {
        String appKey = configService.getRawValue(AuthConfigService.KEY_DINGTALK_APP_KEY);
        String corpId = configService.getRawValue(AuthConfigService.KEY_DINGTALK_CORP_ID);
        String encodedRedirect = URLEncoder.encode(redirectUri, StandardCharsets.UTF_8);
        return "https://login.dingtalk.com/oauth2/auth?"
                + "redirect_uri=" + encodedRedirect
                + "&response_type=code"
                + "&client_id=" + appKey
                + "&scope=openid%20corpid"
                + "&state=dingtalk"
                + "&corpId=" + corpId
                + "&prompt=consent";
    }

    @Override
    public boolean testConnection(AuthConfigService configService) {
        try {
            fetchAccessToken(configService);
            return true;
        } catch (Exception e) {
            log.warn("钉钉连接测试失败: {}", e.getMessage());
            return false;
        }
    }

    private record CachedToken(String token, long expireAt) {}
}
