package com.jefflower.fdserver.ticket.client;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.service.SystemConfigService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Freshdesk API v2 客户端
 * 提供分页遍历、重试机制、限流感知
 *
 * 配置优先级：数据库（SystemConfig）→ 环境变量 → 未配置则报错
 */
@Slf4j
@Component
public class FreshdeskApiClient {

    private final RestTemplate restTemplate;
    private final SystemConfigService configService;

    @Value("${freshdesk.domain:}")
    private String envFreshdeskDomain;

    @Value("${freshdesk.api-key:}")
    private String envApiKey;

    @Value("${freshdesk.api.max-retries:3}")
    private int maxRetries;

    @Value("${freshdesk.api.rate-limit-threshold:10}")
    private int rateLimitThreshold;

    private static final Pattern LINK_NEXT_PATTERN = Pattern.compile("<([^>]+)>;\\s*rel=\"next\"");

    public FreshdeskApiClient(@Qualifier("freshdeskRestTemplate") RestTemplate restTemplate,
                              SystemConfigService configService) {
        this.restTemplate = restTemplate;
        this.configService = configService;
    }

    // ========== 配置获取（DB 优先 → 环境变量兜底） ==========

    /**
     * 获取 Freshdesk 域名，优先从数据库读取，再从环境变量兜底
     * @throws BusinessException 如果未配置
     */
    private String getDomain() {
        // 1. 数据库配置优先
        String dbDomain = configService.getFreshdeskDomain();
        if (dbDomain != null && !dbDomain.isBlank()) {
            return dbDomain;
        }
        // 2. 环境变量兜底
        if (envFreshdeskDomain != null && !envFreshdeskDomain.isBlank()) {
            return envFreshdeskDomain;
        }
        // 3. 未配置
        throw new BusinessException(ErrorCode.INVALID_PARAMETER,
                "Freshdesk 域名未配置，请在系统设置中配置 Freshdesk 连接信息");
    }

    /**
     * 获取 API Key，优先从数据库读取，再从环境变量兜底
     * @throws BusinessException 如果未配置
     */
    private String getApiKey() {
        // 1. 数据库配置优先
        String dbKey = configService.getFreshdeskApiKey();
        if (dbKey != null && !dbKey.isBlank()) {
            return dbKey;
        }
        // 2. 环境变量兜底
        if (envApiKey != null && !envApiKey.isBlank()) {
            return envApiKey;
        }
        // 3. 未配置
        throw new BusinessException(ErrorCode.INVALID_PARAMETER,
                "Freshdesk API Key 未配置，请在系统设置中配置 Freshdesk 连接信息");
    }

    /**
     * 构建带认证头的 HttpEntity（GET 请求用）
     */
    private HttpEntity<Void> buildAuthEntity() {
        HttpHeaders headers = new HttpHeaders();
        String apiKey = getApiKey();
        String auth = apiKey + ":X";
        String encodedAuth = Base64.getEncoder().encodeToString(auth.getBytes(StandardCharsets.UTF_8));
        headers.set("Authorization", "Basic " + encodedAuth);
        headers.set("Content-Type", "application/json");
        return new HttpEntity<>(headers);
    }

    /**
     * 构建带认证头和请求体的 HttpEntity（POST/PUT 请求用）
     */
    private <T> HttpEntity<T> buildAuthEntity(T body) {
        HttpHeaders headers = new HttpHeaders();
        String apiKey = getApiKey();
        String auth = apiKey + ":X";
        String encodedAuth = Base64.getEncoder().encodeToString(auth.getBytes(StandardCharsets.UTF_8));
        headers.set("Authorization", "Basic " + encodedAuth);
        headers.set("Content-Type", "application/json");
        return new HttpEntity<>(body, headers);
    }

    // ========== 公开 API ==========

    /**
     * 带分页获取所有工单
     */
    public List<Map<String, Object>> fetchAllTickets(String updatedSince, Set<Integer> statuses) {
        String domain = getDomain();
        StringBuilder urlBuilder = new StringBuilder();
        urlBuilder.append(String.format(
                "https://%s/api/v2/tickets?order_by=updated_at&order_type=desc&per_page=100&include=description",
                domain));

        if (updatedSince != null && !updatedSince.isEmpty()) {
            urlBuilder.append("&updated_since=").append(updatedSince);
            log.info("Fetching tickets updated since: {}", updatedSince);
        } else {
            log.info("Fetching all tickets (no updated_since filter)");
        }

        List<Map<String, Object>> allTickets = new ArrayList<>();
        String url = urlBuilder.toString();
        int pageCount = 0;

        while (url != null) {
            pageCount++;
            log.info("Fetching tickets page {} ...", pageCount);

            final String currentUrl = url;
            HttpEntity<Void> authEntity = buildAuthEntity();
            ResponseEntity<List<Map<String, Object>>> response = executeWithRetry(
                    () -> restTemplate.exchange(currentUrl, HttpMethod.GET, authEntity,
                            new ParameterizedTypeReference<List<Map<String, Object>>>() {
                            }));

            handleRateLimit(response.getHeaders());

            List<Map<String, Object>> pageTickets = response.getBody();
            if (pageTickets == null || pageTickets.isEmpty()) {
                break;
            }

            // 按状态过滤
            if (statuses != null && !statuses.isEmpty()) {
                pageTickets = pageTickets.stream()
                        .filter(t -> {
                            Object s = t.get("status");
                            return s instanceof Integer && statuses.contains(s);
                        })
                        .toList();
            }

            allTickets.addAll(pageTickets);
            url = extractNextPageUrl(response.getHeaders());
        }

        log.info("Fetched {} tickets across {} pages", allTickets.size(), pageCount);
        return allTickets;
    }

    /**
     * 获取单个工单详情（Webhook 场景使用）
     */
    public Map<String, Object> fetchSingleTicket(String ticketId) {
        String domain = getDomain();
        String url = String.format("https://%s/api/v2/tickets/%s",
                domain, ticketId);

        HttpEntity<Void> authEntity = buildAuthEntity();
        return executeWithRetry(() -> {
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url, HttpMethod.GET, authEntity,
                    new ParameterizedTypeReference<Map<String, Object>>() {
                    });
            handleRateLimit(response.getHeaders());
            return response.getBody();
        });
    }

    /**
     * 带分页获取工单的所有对话
     */
    public List<Map<String, Object>> fetchAllConversations(String ticketId) {
        String domain = getDomain();
        String url = String.format("https://%s/api/v2/tickets/%s/conversations?per_page=100",
                domain, ticketId);

        List<Map<String, Object>> allConversations = new ArrayList<>();
        int pageCount = 0;

        while (url != null) {
            pageCount++;
            final String currentUrl = url;

            try {
                HttpEntity<Void> authEntity = buildAuthEntity();
                ResponseEntity<List<Map<String, Object>>> response = executeWithRetry(
                        () -> restTemplate.exchange(currentUrl, HttpMethod.GET, authEntity,
                                new ParameterizedTypeReference<List<Map<String, Object>>>() {
                                }));

                handleRateLimit(response.getHeaders());

                List<Map<String, Object>> pageConversations = response.getBody();
                if (pageConversations == null || pageConversations.isEmpty()) {
                    break;
                }

                allConversations.addAll(pageConversations);
                url = extractNextPageUrl(response.getHeaders());
            } catch (Exception e) {
                log.error("Error fetching conversations page {} for ticket {}: {}",
                        pageCount, ticketId, e.getMessage());
                break;
            }
        }

        if (pageCount > 1) {
            log.info("Fetched {} conversations across {} pages for ticket {}",
                    allConversations.size(), pageCount, ticketId);
        }

        return allConversations;
    }

    /**
     * 推送回复到 Freshdesk
     */
    public void pushReply(String ticketExternalId, String body) {
        String domain = getDomain();
        String url = String.format("https://%s/api/v2/tickets/%s/reply",
                domain, ticketExternalId);

        Map<String, Object> requestBody = Map.of("body", body);
        HttpEntity<Map<String, Object>> entity = buildAuthEntity(requestBody);

        executeWithRetry(() -> {
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url, HttpMethod.POST, entity,
                    new ParameterizedTypeReference<Map<String, Object>>() {
                    });
            handleRateLimit(response.getHeaders());
            return response.getBody();
        });

        log.info("Successfully pushed reply to Freshdesk for ticket #{}", ticketExternalId);
    }

    /**
     * 更新 Freshdesk 工单状态
     */
    public void updateTicketStatus(String ticketExternalId, int status) {
        String domain = getDomain();
        String url = String.format("https://%s/api/v2/tickets/%s",
                domain, ticketExternalId);

        Map<String, Object> requestBody = Map.of("status", status);
        HttpEntity<Map<String, Object>> entity = buildAuthEntity(requestBody);

        executeWithRetry(() -> {
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url, HttpMethod.PUT, entity,
                    new ParameterizedTypeReference<Map<String, Object>>() {
                    });
            handleRateLimit(response.getHeaders());
            return response.getBody();
        });

        log.info("Updated Freshdesk ticket #{} status to {}", ticketExternalId, status);
    }

    // ========== 内部方法 ==========

    private <T> T executeWithRetry(Supplier<T> apiCall) {
        int attempt = 0;
        while (true) {
            try {
                return apiCall.get();
            } catch (HttpClientErrorException e) {
                attempt++;

                if (e.getStatusCode() == HttpStatus.TOO_MANY_REQUESTS) {
                    long waitMs = parseRetryAfter(e.getResponseHeaders());
                    log.warn("Rate limited (429), waiting {}ms before retry (attempt {}/{})",
                            waitMs, attempt, maxRetries);
                    sleep(waitMs);
                    continue;
                }

                if (attempt >= maxRetries) {
                    log.error("API call failed after {} attempts: {} {}",
                            maxRetries, e.getStatusCode(), e.getStatusText());
                    throw e;
                }

                long backoffMs = (long) Math.pow(2, attempt - 1) * 1000;
                log.warn("API call failed (attempt {}/{}), retrying in {}ms: {} {}",
                        attempt, maxRetries, backoffMs, e.getStatusCode(), e.getStatusText());
                sleep(backoffMs);
            } catch (Exception e) {
                attempt++;
                if (attempt >= maxRetries) {
                    log.error("API call failed after {} attempts: {}", maxRetries, e.getMessage());
                    throw e;
                }

                long backoffMs = (long) Math.pow(2, attempt - 1) * 1000;
                log.warn("API call failed (attempt {}/{}), retrying in {}ms: {}",
                        attempt, maxRetries, backoffMs, e.getMessage());
                sleep(backoffMs);
            }
        }
    }

    private String extractNextPageUrl(HttpHeaders headers) {
        List<String> linkHeaders = headers.get("Link");
        if (linkHeaders == null || linkHeaders.isEmpty()) {
            return null;
        }

        for (String linkHeader : linkHeaders) {
            Matcher matcher = LINK_NEXT_PATTERN.matcher(linkHeader);
            if (matcher.find()) {
                return matcher.group(1);
            }
        }
        return null;
    }

    private void handleRateLimit(HttpHeaders headers) {
        List<String> remaining = headers.get("X-RateLimit-Remaining");
        if (remaining != null && !remaining.isEmpty()) {
            try {
                int remainingCount = Integer.parseInt(remaining.get(0));
                if (remainingCount <= rateLimitThreshold) {
                    log.warn("Approaching rate limit, {} requests remaining. Sleeping 5s...", remainingCount);
                    sleep(5000);
                }
            } catch (NumberFormatException e) {
                // ignore
            }
        }
    }

    private long parseRetryAfter(HttpHeaders headers) {
        if (headers != null) {
            List<String> retryAfter = headers.get("Retry-After");
            if (retryAfter != null && !retryAfter.isEmpty()) {
                try {
                    return Long.parseLong(retryAfter.get(0)) * 1000;
                } catch (NumberFormatException e) {
                    // ignore
                }
            }
        }
        return 60_000;
    }

    private void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Interrupted during API backoff", e);
        }
    }
}
