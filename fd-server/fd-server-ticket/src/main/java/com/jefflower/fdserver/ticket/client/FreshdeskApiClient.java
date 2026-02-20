package com.jefflower.fdserver.ticket.client;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.util.*;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Freshdesk API v2 客户端
 * 提供分页遍历、重试机制、限流感知
 */
@Slf4j
@Component
public class FreshdeskApiClient {

    private final RestTemplate restTemplate;

    @Value("${freshdesk.domain}")
    private String freshdeskDomain;

    @Value("${freshdesk.api.max-retries:3}")
    private int maxRetries;

    @Value("${freshdesk.api.rate-limit-threshold:10}")
    private int rateLimitThreshold;

    private static final Pattern LINK_NEXT_PATTERN = Pattern.compile("<([^>]+)>;\\s*rel=\"next\"");

    public FreshdeskApiClient(@Qualifier("freshdeskRestTemplate") RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    /**
     * 带分页获取所有工单
     *
     * @param updatedSince ISO 格式时间戳（可选）
     * @param statuses     要获取的 Freshdesk 状态码集合（如 {2, 3}）
     * @return 所有匹配工单列表
     */
    public List<Map<String, Object>> fetchAllTickets(String updatedSince, Set<Integer> statuses) {
        StringBuilder urlBuilder = new StringBuilder();
        urlBuilder.append(String.format(
                "https://%s/api/v2/tickets?order_by=updated_at&order_type=desc&per_page=100&include=description",
                freshdeskDomain));

        if (updatedSince != null && !updatedSince.isEmpty()) {
            // 不做 URLEncoder.encode —— 时间戳字符在 query 参数中安全，且 RestTemplate 会自行处理编码
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
            ResponseEntity<List<Map<String, Object>>> response = executeWithRetry(
                    () -> restTemplate.exchange(currentUrl, HttpMethod.GET, HttpEntity.EMPTY,
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
        String url = String.format("https://%s/api/v2/tickets/%s?include=description",
                freshdeskDomain, ticketId);

        return executeWithRetry(() -> {
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url, HttpMethod.GET, HttpEntity.EMPTY,
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
        String url = String.format("https://%s/api/v2/tickets/%s/conversations?per_page=100",
                freshdeskDomain, ticketId);

        List<Map<String, Object>> allConversations = new ArrayList<>();
        int pageCount = 0;

        while (url != null) {
            pageCount++;
            final String currentUrl = url;

            try {
                ResponseEntity<List<Map<String, Object>>> response = executeWithRetry(
                        () -> restTemplate.exchange(currentUrl, HttpMethod.GET, HttpEntity.EMPTY,
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
        String url = String.format("https://%s/api/v2/tickets/%s/reply",
                freshdeskDomain, ticketExternalId);

        Map<String, Object> requestBody = Map.of("body", body);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody);

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
     * 带重试的 API 调用执行
     * 策略：最多 maxRetries 次，指数退避（1s, 2s, 4s）
     * HTTP 429 时读 Retry-After header
     */
    private <T> T executeWithRetry(Supplier<T> apiCall) {
        int attempt = 0;
        while (true) {
            try {
                return apiCall.get();
            } catch (HttpClientErrorException e) {
                attempt++;

                if (e.getStatusCode() == HttpStatus.TOO_MANY_REQUESTS) {
                    // 429 限流
                    long waitMs = parseRetryAfter(e.getResponseHeaders());
                    log.warn("Rate limited (429), waiting {}ms before retry (attempt {}/{})",
                            waitMs, attempt, maxRetries);
                    sleep(waitMs);
                    continue; // 429 不计入 maxRetries
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

    /**
     * 解析 Link header 中的 next 页 URL
     * 格式: <https://domain/api/v2/tickets?page=2>; rel="next"
     */
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

    /**
     * 检查速率限制，低于阈值时主动休眠
     */
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

    /**
     * 解析 Retry-After header（秒），默认 60 秒
     */
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
        return 60_000; // 默认 60 秒
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
