package com.jefflower.fdserver.workflow.event;

import com.jefflower.fdserver.task.sse.SseConnectionManager;
import com.jefflower.fdserver.task.sse.SseEventData;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 监听工作流状态事件，通过 SSE 推送给前端
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkflowSseListener {

    private final SseConnectionManager sseConnectionManager;

    @Async
    @EventListener
    public void onWorkflowStatus(WorkflowStatusEvent event) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("processInstanceId", event.getProcessInstanceId());
        data.put("businessKey", event.getBusinessKey());
        data.put("currentActivityId", event.getCurrentActivityId());
        data.put("status", event.getStatus());

        sseConnectionManager.broadcast(new SseEventData("workflow-status", data));
        log.debug("[SSE] Broadcast workflow-status: businessKey={}, status={}",
                event.getBusinessKey(), event.getStatus());
    }
}
