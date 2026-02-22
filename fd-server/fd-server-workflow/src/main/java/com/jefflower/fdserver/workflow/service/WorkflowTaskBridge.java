package com.jefflower.fdserver.workflow.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.task.entity.TaskInstance;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * 任务完成 → 流程唤醒桥接器。
 * <p>
 * 当 TaskInstance 完成时，检查 payload 中是否携带 processInstanceId + waitActivityId，
 * 若存在则自动唤醒对应的 ReceiveTask，实现 CLIENT_ONLY Agent 的异步等待/唤醒。
 */
@Service
public class WorkflowTaskBridge {

    private static final Logger log = LoggerFactory.getLogger(WorkflowTaskBridge.class);

    private final WorkflowService workflowService;
    private final ObjectMapper objectMapper;

    public WorkflowTaskBridge(WorkflowService workflowService, ObjectMapper objectMapper) {
        this.workflowService = workflowService;
        this.objectMapper = objectMapper;
    }

    /**
     * 当任务完成时调用，检查是否需要唤醒工作流 ReceiveTask
     *
     * @param task       已完成的 TaskInstance
     * @param resultVars 任务执行结果变量（传递给流程）
     */
    public void onTaskCompleted(TaskInstance task, Map<String, Object> resultVars) {
        if (task.getPayload() == null || task.getPayload().isBlank()) {
            return;
        }

        try {
            Map<String, Object> payload = objectMapper.readValue(
                    task.getPayload(), new TypeReference<>() {});

            String processInstanceId = (String) payload.get("processInstanceId");
            String waitActivityId = (String) payload.get("waitActivityId");

            if (processInstanceId == null || waitActivityId == null) {
                return;
            }

            log.info("[WorkflowTaskBridge] Task {} completed, signaling ReceiveTask: processInstanceId={}, activityId={}",
                    task.getId(), processInstanceId, waitActivityId);

            workflowService.signalReceiveTask(processInstanceId, waitActivityId, resultVars);

        } catch (Exception e) {
            log.error("[WorkflowTaskBridge] Failed to signal workflow for task {}: {}",
                    task.getId(), e.getMessage(), e);
        }
    }
}
