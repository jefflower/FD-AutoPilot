package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.ai.service.N8nConfigProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * N8nConfigProvider 的实现，委托给 SystemConfigService 读取数据库配置。
 */
@Component
@RequiredArgsConstructor
public class N8nConfigProviderImpl implements N8nConfigProvider {

    private final SystemConfigService systemConfigService;

    @Override
    public String getN8nApiUrl() {
        return systemConfigService.getN8nApiUrl();
    }

    @Override
    public String getN8nApiKey() {
        return systemConfigService.getN8nApiKey();
    }
}
