package com.jefflower.fdserver.task.sse;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * SSE 连接管理器 — 管理所有客户端的 SSE 长连接
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SseConnectionManager {

    private final ConcurrentHashMap<String, SseEmitter> connections = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper;

    public void connect(String clientId, SseEmitter emitter) {
        SseEmitter old = connections.put(clientId, emitter);
        if (old != null) {
            try {
                old.complete();
            } catch (Exception ignored) {
            }
        }
        log.info("[SSE] Client connected: {}, total connections: {}", clientId, connections.size());
    }

    public void disconnect(String clientId) {
        SseEmitter removed = connections.remove(clientId);
        if (removed != null) {
            log.info("[SSE] Client disconnected: {}, total connections: {}", clientId, connections.size());
        }
    }

    /**
     * 广播事件给所有连接的客户端
     */
    public void broadcast(SseEventData eventData) {
        if (connections.isEmpty()) {
            return;
        }

        String jsonData;
        try {
            jsonData = objectMapper.writeValueAsString(eventData.getData());
        } catch (Exception e) {
            log.error("[SSE] Failed to serialize event data", e);
            return;
        }

        for (Map.Entry<String, SseEmitter> entry : connections.entrySet()) {
            try {
                entry.getValue().send(
                        SseEmitter.event()
                                .name(eventData.getEventType())
                                .data(jsonData)
                );
            } catch (IOException e) {
                log.debug("[SSE] Failed to send to client {}, removing", entry.getKey());
                connections.remove(entry.getKey());
            }
        }
    }

    /**
     * 向指定客户端推送事件
     */
    public void sendToClient(String clientId, SseEventData eventData) {
        SseEmitter emitter = connections.get(clientId);
        if (emitter == null) {
            return;
        }

        try {
            String jsonData = objectMapper.writeValueAsString(eventData.getData());
            emitter.send(
                    SseEmitter.event()
                            .name(eventData.getEventType())
                            .data(jsonData)
            );
        } catch (IOException e) {
            log.debug("[SSE] Failed to send to client {}, removing", clientId);
            connections.remove(clientId);
        } catch (Exception e) {
            log.error("[SSE] Unexpected error sending to client {}", clientId, e);
        }
    }

    /**
     * 发送心跳保活
     */
    public void heartbeat() {
        for (Map.Entry<String, SseEmitter> entry : connections.entrySet()) {
            try {
                entry.getValue().send(SseEmitter.event().comment("heartbeat"));
            } catch (IOException e) {
                log.debug("[SSE] Heartbeat failed for client {}, removing", entry.getKey());
                connections.remove(entry.getKey());
            }
        }
    }

    public int getConnectionCount() {
        return connections.size();
    }
}
