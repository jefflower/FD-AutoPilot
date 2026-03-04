package com.jefflower.fdserver.config;

import com.jefflower.fdserver.ticket.service.SystemConfigService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import java.io.IOException;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * n8n WebSocket 反向代理处理器。
 * <p>
 * 客户端连接 ws://host:9988/n8n/... 时，本处理器建立到 n8n 后端的 WebSocket 连接，
 * 实现双向消息转发。支持文本消息、二进制消息和 ping/pong。
 */
@Slf4j
@Component
public class N8nWebSocketProxyHandler extends AbstractWebSocketHandler {

    private static final String PROXY_PREFIX = "/n8n";

    private final SystemConfigService systemConfigService;

    @Value("${n8n.api-url:http://localhost:5678}")
    private String defaultN8nUrl;

    /**
     * 客户端 session → n8n 后端 session 的映射
     */
    private final Map<String, WebSocketSession> clientToBackend = new ConcurrentHashMap<>();

    public N8nWebSocketProxyHandler(SystemConfigService systemConfigService) {
        this.systemConfigService = systemConfigService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession clientSession) throws Exception {
        String targetWsUrl = buildTargetWsUrl(clientSession);
        log.info("[N8nWsProxy] 客户端连接: {} → 转发到: {}", clientSession.getUri(), targetWsUrl);

        try {
            // 建立到 n8n 后端的 WebSocket 连接
            StandardWebSocketClient wsClient = new StandardWebSocketClient();
            WebSocketSession backendSession = wsClient.execute(
                    new BackendWebSocketHandler(clientSession),
                    targetWsUrl
            ).get(30, TimeUnit.SECONDS);

            clientToBackend.put(clientSession.getId(), backendSession);
            log.info("[N8nWsProxy] 后端 WebSocket 连接已建立: {}", targetWsUrl);
        } catch (Exception e) {
            log.error("[N8nWsProxy] 无法连接到 n8n WebSocket: {}", targetWsUrl, e);
            clientSession.close(CloseStatus.SERVER_ERROR);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession clientSession, TextMessage message) throws Exception {
        // 客户端 → n8n 后端
        WebSocketSession backendSession = clientToBackend.get(clientSession.getId());
        if (backendSession != null && backendSession.isOpen()) {
            backendSession.sendMessage(message);
        }
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession clientSession, BinaryMessage message) throws Exception {
        // 客户端 → n8n 后端
        WebSocketSession backendSession = clientToBackend.get(clientSession.getId());
        if (backendSession != null && backendSession.isOpen()) {
            backendSession.sendMessage(message);
        }
    }

    @Override
    protected void handlePongMessage(WebSocketSession clientSession, PongMessage message) throws Exception {
        // 客户端 pong → n8n 后端
        WebSocketSession backendSession = clientToBackend.get(clientSession.getId());
        if (backendSession != null && backendSession.isOpen()) {
            backendSession.sendMessage(message);
        }
    }

    @Override
    public void handleTransportError(WebSocketSession clientSession, Throwable exception) throws Exception {
        log.warn("[N8nWsProxy] 客户端传输错误: {}", exception.getMessage());
        closeBackendSession(clientSession.getId());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession clientSession, CloseStatus status) throws Exception {
        log.info("[N8nWsProxy] 客户端断开连接: {} ({})", clientSession.getId(), status);
        closeBackendSession(clientSession.getId());
    }

    @Override
    public boolean supportsPartialMessages() {
        return true;
    }

    /**
     * 构建目标 WebSocket URL：将 http(s) 转换为 ws(s)，去掉 /n8n 前缀。
     */
    private String buildTargetWsUrl(WebSocketSession clientSession) {
        String baseUrl = resolveN8nUrl();

        // http → ws, https → wss
        String wsBase;
        if (baseUrl.startsWith("https://")) {
            wsBase = "wss://" + baseUrl.substring("https://".length());
        } else if (baseUrl.startsWith("http://")) {
            wsBase = "ws://" + baseUrl.substring("http://".length());
        } else {
            wsBase = baseUrl;
        }

        // 去掉 /n8n 前缀
        String path = clientSession.getUri().getPath();
        if (path.startsWith(PROXY_PREFIX)) {
            path = path.substring(PROXY_PREFIX.length());
        }
        if (!path.startsWith("/")) {
            path = "/" + path;
        }

        // 拼接查询参数
        String query = clientSession.getUri().getQuery();
        if (query != null && !query.isEmpty()) {
            return wsBase + path + "?" + query;
        }
        return wsBase + path;
    }

    /**
     * 解析 n8n 目标地址：优先数据库配置，fallback 到 application.yml。
     */
    private String resolveN8nUrl() {
        try {
            String dbUrl = systemConfigService.getN8nApiUrl();
            if (dbUrl != null && !dbUrl.isBlank()) {
                return stripTrailingSlash(dbUrl);
            }
        } catch (Exception e) {
            log.warn("[N8nWsProxy] 读取数据库 n8n_api_url 配置失败，使用默认值", e);
        }
        return stripTrailingSlash(defaultN8nUrl);
    }

    private void closeBackendSession(String clientSessionId) {
        WebSocketSession backendSession = clientToBackend.remove(clientSessionId);
        if (backendSession != null && backendSession.isOpen()) {
            try {
                backendSession.close();
            } catch (IOException e) {
                log.warn("[N8nWsProxy] 关闭后端 WebSocket 连接失败", e);
            }
        }
    }

    private String stripTrailingSlash(String url) {
        if (url != null && url.endsWith("/")) {
            return url.substring(0, url.length() - 1);
        }
        return url;
    }

    /**
     * n8n 后端 WebSocket 的处理器：将后端消息转发回客户端。
     */
    private static class BackendWebSocketHandler extends AbstractWebSocketHandler {
        private final WebSocketSession clientSession;

        BackendWebSocketHandler(WebSocketSession clientSession) {
            this.clientSession = clientSession;
        }

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
            // n8n 后端 → 客户端
            if (clientSession.isOpen()) {
                clientSession.sendMessage(message);
            }
        }

        @Override
        protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) throws Exception {
            // n8n 后端 → 客户端
            if (clientSession.isOpen()) {
                clientSession.sendMessage(message);
            }
        }

        @Override
        protected void handlePongMessage(WebSocketSession session, PongMessage message) throws Exception {
            // n8n 后端 pong → 客户端
            if (clientSession.isOpen()) {
                clientSession.sendMessage(message);
            }
        }

        @Override
        public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
            log.warn("[N8nWsProxy] 后端传输错误: {}", exception.getMessage());
            if (clientSession.isOpen()) {
                clientSession.close(CloseStatus.SERVER_ERROR);
            }
        }

        @Override
        public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
            log.info("[N8nWsProxy] 后端断开连接: {} ({})", session.getId(), status);
            if (clientSession.isOpen()) {
                clientSession.close(status);
            }
        }

        @Override
        public boolean supportsPartialMessages() {
            return true;
        }
    }
}
