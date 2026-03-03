package com.jefflower.fdserver.task.controller;

import com.jefflower.fdserver.task.sse.SseConnectionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import io.swagger.v3.oas.annotations.tags.Tag;

import java.io.IOException;
import java.util.Map;

/**
 * SSE 事件流端点 — 客户端通过此端点订阅实时事件
 */
@Tag(name = "事件流", description = "SSE 实时事件推送端点")
@Slf4j
@RestController
@RequestMapping("/api/v1/events")
@RequiredArgsConstructor
public class EventStreamController {

    private final SseConnectionManager sseConnectionManager;

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter subscribe(@RequestParam String clientId) {
        SseEmitter emitter = new SseEmitter(0L); // 无超时，由心跳和客户端重连管理

        sseConnectionManager.connect(clientId, emitter);

        emitter.onCompletion(() -> sseConnectionManager.disconnect(clientId));
        emitter.onTimeout(() -> sseConnectionManager.disconnect(clientId));
        emitter.onError(e -> {
            log.debug("[SSE] Connection error for client {}: {}", clientId, e.getMessage());
            sseConnectionManager.disconnect(clientId);
        });

        // 发送初始连接成功事件
        try {
            emitter.send(
                    SseEmitter.event()
                            .name("connected")
                            .data(Map.of("clientId", clientId)));
        } catch (IOException e) {
            log.warn("[SSE] Failed to send connected event to client {}", clientId);
        }

        return emitter;
    }
}
