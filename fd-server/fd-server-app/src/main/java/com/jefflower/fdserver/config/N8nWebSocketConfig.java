package com.jefflower.fdserver.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.support.WebSocketHandlerMapping;

/**
 * n8n WebSocket 反向代理配置。
 * <p>
 * 将 /n8n/** 路径下的 WebSocket 升级请求转发到 n8n 后端。
 * 允许所有来源（n8n 有自己的认证机制）。
 * <p>
 * 关键配置说明：
 * <ul>
 *   <li>WebSocket handler 的 order 设为 -1（高于 RequestMappingHandlerMapping 的 0），
 *       确保 WebSocket upgrade 请求优先匹配</li>
 *   <li>启用 webSocketUpgradeMatch，使得非 WebSocket 请求（普通 HTTP）
 *       不被 WebSocket handler 拦截，正确落到 N8nProxyController 的 @RequestMapping</li>
 * </ul>
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

    /**
     * 在 WebSocketHandlerMapping 创建后，调整其行为：
     * 1. 设置 order=-1，使其优先于 RequestMappingHandlerMapping(order=0)
     * 2. 启用 webSocketUpgradeMatch，仅匹配真正的 WebSocket upgrade 请求，
     *    非 WebSocket 的 HTTP 请求交给 N8nProxyController 处理
     */
    @Bean
    public org.springframework.beans.factory.config.BeanPostProcessor webSocketHandlerMappingPostProcessor() {
        return new org.springframework.beans.factory.config.BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String beanName) {
                if (bean instanceof WebSocketHandlerMapping wsMapping) {
                    wsMapping.setOrder(-1);
                    wsMapping.setWebSocketUpgradeMatch(true);
                }
                return bean;
            }
        };
    }
}
