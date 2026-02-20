package com.jefflower.fdserver.common.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;

/**
 * Freshdesk REST 客户端配置
 */
@Configuration
public class RestTemplateConfig {

    @Value("${freshdesk.api-key}")
    private String apiKey;

    @Value("${freshdesk.api.connect-timeout:10000}")
    private int connectTimeout;

    @Value("${freshdesk.api.read-timeout:30000}")
    private int readTimeout;

    @Bean("freshdeskRestTemplate")
    public RestTemplate freshdeskRestTemplate(RestTemplateBuilder builder) {
        String auth = apiKey + ":X";
        String encodedAuth = Base64.getEncoder().encodeToString(auth.getBytes(StandardCharsets.UTF_8));

        return builder
                .setConnectTimeout(Duration.ofMillis(connectTimeout))
                .setReadTimeout(Duration.ofMillis(readTimeout))
                .defaultHeader("Authorization", "Basic " + encodedAuth)
                .defaultHeader("Content-Type", "application/json")
                .build();
    }
}
