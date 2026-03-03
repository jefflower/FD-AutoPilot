package com.jefflower.fdserver.task.sse;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * SSE 心跳定时任务 — 每 30 秒发送心跳保活，清理死连接
 */
@Component
@RequiredArgsConstructor
public class SseHeartbeatScheduler {

    private final SseConnectionManager sseConnectionManager;

    @Scheduled(fixedRate = 30000)
    public void sendHeartbeat() {
        if (sseConnectionManager.getConnectionCount() > 0) {
            sseConnectionManager.heartbeat();
        }
    }
}
