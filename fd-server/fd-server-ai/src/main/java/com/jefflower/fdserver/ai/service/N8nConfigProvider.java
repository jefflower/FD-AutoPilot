package com.jefflower.fdserver.ai.service;

/**
 * n8n 配置提供者接口（SPI）。
 * <p>
 * 定义在 ai 模块中，由 ticket 模块实现（通过 SystemConfigService 读写数据库配置）。
 * 遵守模块依赖链 common ← auth ← task ← ai ← ticket ← app，
 * 避免 ai 模块反向依赖 ticket 模块。
 */
public interface N8nConfigProvider {

    /**
     * 获取 n8n API URL（数据库配置值，可能为 null）。
     */
    String getN8nApiUrl();

    /**
     * 获取 n8n API Key（数据库配置值，可能为 null）。
     */
    String getN8nApiKey();
}
