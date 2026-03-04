package com.jefflower.fdserver.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * n8n WebSocket 反向代理配置。
 * <p>
 * 将 /n8n/** 路径下的 WebSocket 升级请求转发到 n8n 后端。
 * 允许所有来源（n8n 有自己的认证机制）。
 */
@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class N8nWebSocketConfig implements WebSocketConfigurer {

    private final N8nWebSocketProxyHandler n8nWebSocketProxyHandler;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(n8nWebSocketProxyHandler, "/n8n/**")
                .setAllowedOrigins("*");
    }
}
