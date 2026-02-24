package com.jefflower.fdserver.workflow.listener;

import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.event.TaskCompletedEvent;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import com.jefflower.fdserver.workflow.service.WorkflowTaskBridge;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Map;

/**
 * 监听 task 模块发布的 TaskCompletedEvent，桥接到 WorkflowTaskBridge。
 * <p>
 * 只处理 success=true 且 payload 包含 processInstanceId 的任务（即工作流任务），
 * 调用 WorkflowTaskBridge.onTaskCompleted() 唤醒对应的 ReceiveTask。
 * <p>
 * 使用 @TransactionalEventListener(AFTER_COMMIT) 确保：
 * 1. 任务状态已经持久化到数据库
 * 2. findById 能读到最新数据
 * 3. 避免事务回滚导致工作流唤醒但任务未完成的不一致状态
 */
@Component
public class WorkflowTaskCompletionListener {
    private static final Logger log = LoggerFactory.getLogger(WorkflowTaskCompletionListener.class);

    private final WorkflowTaskBridge bridge;
    private final TaskInstanceRepository taskInstanceRepository;

    public WorkflowTaskCompletionListener(WorkflowTaskBridge bridge,
                                           TaskInstanceRepository taskInstanceRepository) {
        this.bridge = bridge;
        this.taskInstanceRepository = taskInstanceRepository;
        log.info("[WorkflowTaskCompletionListener] Initialized — listening for TaskCompletedEvent (AFTER_COMMIT)");
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onTaskCompleted(TaskCompletedEvent event) {
        log.debug("[WorkflowTaskCompletionListener] Received TaskCompletedEvent: taskId={}, type={}, success={}",
                event.getTaskInstanceId(), event.getTaskType(), event.isSuccess());

        if (!event.isSuccess()) {
            log.debug("[WorkflowTaskCompletionListener] Skipping failed task {}", event.getTaskInstanceId());
            return;
        }

        taskInstanceRepository.findById(event.getTaskInstanceId()).ifPresentOrElse(task -> {
            if (task.getPayload() == null || !task.getPayload().contains("processInstanceId")) {
                log.debug("[WorkflowTaskCompletionListener] Task {} has no processInstanceId in payload, skipping workflow bridge",
                        event.getTaskInstanceId());
                return;
            }
            log.info("[WorkflowTaskCompletionListener] Task {} (type={}) completed, bridging to workflow",
                    event.getTaskInstanceId(), task.getTaskType());
            try {
                bridge.onTaskCompleted(task, Map.of("taskSuccess", true));
            } catch (Exception e) {
                log.error("[WorkflowTaskCompletionListener] Failed to bridge task {} to workflow: {}",
                        event.getTaskInstanceId(), e.getMessage(), e);
            }
        }, () -> {
            log.warn("[WorkflowTaskCompletionListener] Task {} not found in database after commit!",
                    event.getTaskInstanceId());
        });
    }
}
