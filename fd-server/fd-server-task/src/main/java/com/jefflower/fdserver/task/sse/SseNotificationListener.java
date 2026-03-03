package com.jefflower.fdserver.task.sse;

import com.jefflower.fdserver.task.event.TaskCompletedEvent;
import com.jefflower.fdserver.task.event.TaskPushEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 监听 Spring ApplicationEvent，转发为 SSE 推送
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SseNotificationListener {

    private final SseConnectionManager sseConnectionManager;

    @Async
    @EventListener
    public void onTaskPush(TaskPushEvent event) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("taskType", event.getTaskType());
        data.put("taskInstanceId", event.getTaskInstanceId());
        data.put("referenceType", event.getReferenceType());
        data.put("referenceId", event.getReferenceId());
        if (event.getMetadata() != null) {
            data.put("metadata", event.getMetadata());
        }

        sseConnectionManager.broadcast(new SseEventData("task-available", data));
        log.debug("[SSE] Broadcast task-available: type={}, taskId={}",
                event.getTaskType(), event.getTaskInstanceId());
    }

    @Async
    @EventListener
    public void onTaskCompleted(TaskCompletedEvent event) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("taskInstanceId", event.getTaskInstanceId());
        data.put("taskType", event.getTaskType());
        data.put("success", event.isSuccess());
        data.put("clientId", event.getClientId());

        sseConnectionManager.broadcast(new SseEventData("task-completed", data));
        log.debug("[SSE] Broadcast task-completed: type={}, taskId={}, success={}",
                event.getTaskType(), event.getTaskInstanceId(), event.isSuccess());
    }
}
