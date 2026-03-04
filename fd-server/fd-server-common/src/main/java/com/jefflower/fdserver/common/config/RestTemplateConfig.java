package com.jefflower.fdserver.common.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

/**
 * Freshdesk REST 客户端配置
 * 仅配置超时和 Content-Type，认证头由 FreshdeskApiClient 动态添加（支持从数据库读取配置）
 */
@Configuration
public class RestTemplateConfig {

    @Value("${freshdesk.api.connect-timeout:10000}")
    private int connectTimeout;

    @Value("${freshdesk.api.read-timeout:30000}")
    private int readTimeout;

    @Bean("freshdeskRestTemplate")
    public RestTemplate freshdeskRestTemplate(RestTemplateBuilder builder) {
        return builder
                .setConnectTimeout(Duration.ofMillis(connectTimeout))
                .setReadTimeout(Duration.ofMillis(readTimeout))
                .defaultHeader("Content-Type", "application/json")
                .build();
    }
}
