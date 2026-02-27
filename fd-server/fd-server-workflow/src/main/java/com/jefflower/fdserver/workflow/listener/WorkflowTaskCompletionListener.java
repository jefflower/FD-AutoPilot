package com.jefflower.fdserver.workflow.listener;

import com.jefflower.fdserver.task.entity.TaskDefinition;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.event.TaskCompletedEvent;
import com.jefflower.fdserver.task.event.TaskPushEvent;
import com.jefflower.fdserver.task.repository.TaskDefinitionRepository;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import com.jefflower.fdserver.workflow.service.WorkflowTaskBridge;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 监听 task 模块发布的 TaskCompletedEvent，桥接到 WorkflowTaskBridge。
 * <p>
 * 只处理 success=true 且 payload 包含 processInstanceId 的任务（即工作流任务），
 * 调用 WorkflowTaskBridge.onTaskCompleted() 唤醒对应的 ReceiveTask。
 * <p>
 * 使用 @Async + @TransactionalEventListener(AFTER_COMMIT) 确保：
 * 1. 任务状态已经持久化到数据库（AFTER_COMMIT 保证）
 * 2. 在独立线程中执行，拥有干净的事务/EntityManager 上下文
 * 3. 避免 AFTER_COMMIT 回调中 Hibernate Session 未正确绑定事务的问题
 *    （根因：AFTER_COMMIT 回调在原始事务清理后执行，即使调用 @Transactional 方法，
 *    Flowable 命令上下文内的 JPA @Modifying 查询仍无法获取有效的 Hibernate 事务）
 */
@Component
public class WorkflowTaskCompletionListener {
    private static final Logger log = LoggerFactory.getLogger(WorkflowTaskCompletionListener.class);

    private static final int DEFAULT_MAX_RETRIES = 3;

    private final WorkflowTaskBridge bridge;
    private final TaskInstanceRepository taskInstanceRepository;
    private final TaskDefinitionRepository taskDefinitionRepository;
    private final ApplicationEventPublisher eventPublisher;

    public WorkflowTaskCompletionListener(WorkflowTaskBridge bridge,
                                           TaskInstanceRepository taskInstanceRepository,
                                           TaskDefinitionRepository taskDefinitionRepository,
                                           ApplicationEventPublisher eventPublisher) {
        this.bridge = bridge;
        this.taskInstanceRepository = taskInstanceRepository;
        this.taskDefinitionRepository = taskDefinitionRepository;
        this.eventPublisher = eventPublisher;
        log.info("[WorkflowTaskCompletionListener] Initialized — listening for TaskCompletedEvent (AFTER_COMMIT + ASYNC)");
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onTaskCompleted(TaskCompletedEvent event) {
        log.debug("[WorkflowTaskCompletionListener] Received TaskCompletedEvent: taskId={}, type={}, success={}",
                event.getTaskInstanceId(), event.getTaskType(), event.isSuccess());

        if (!event.isSuccess()) {
            handleFailedTask(event);
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

    /**
     * 处理失败的任务：
     * - 未超重试上限 → 重置为 PENDING，等待客户端重新领取
     * - 已超重试上限 → 标记 TIMEOUT，signal ReceiveTask 传入 taskSuccess=false 让流程感知失败
     */
    @Transactional
    void handleFailedTask(TaskCompletedEvent event) {
        taskInstanceRepository.findById(event.getTaskInstanceId()).ifPresentOrElse(task -> {
            int maxRetries = getMaxRetries(task.getTaskType());

            if (task.getRetryCount() < maxRetries) {
                // 重试：重置为 PENDING，增加重试计数
                int newRetryCount = task.getRetryCount() + 1;
                task.setStatus(TaskStatus.PENDING);
                task.setAssignedTo(null);
                task.setAssignedAt(null);
                task.setStartedAt(null);
                task.setCompletedAt(null);
                task.setRetryCount(newRetryCount);
                task.setErrorMessage(event.getErrorMessage());
                taskInstanceRepository.save(task);

                log.warn("[WorkflowTaskCompletionListener] Task {} failed (retry {}/{}), reset to PENDING for re-claim",
                        task.getId(), newRetryCount, maxRetries);

                // 发布 TaskPushEvent 通知客户端有任务可领取
                eventPublisher.publishEvent(new TaskPushEvent(
                        this, task.getTaskType(), task.getId(), task.getReferenceType(),
                        parseLongSafe(task.getReferenceId()), null));
            } else {
                // 超过重试上限：标记为 TIMEOUT，通知工作流失败
                task.setStatus(TaskStatus.TIMEOUT);
                task.setErrorMessage("Exceeded max retries (" + maxRetries + "): " +
                        (event.getErrorMessage() != null ? event.getErrorMessage() : "unknown error"));
                task.setCompletedAt(LocalDateTime.now());
                taskInstanceRepository.save(task);

                log.error("[WorkflowTaskCompletionListener] Task {} permanently failed after {} retries, signaling workflow with taskSuccess=false",
                        task.getId(), maxRetries);

                // Signal ReceiveTask 让 BPMN 流程知道任务失败了（而不是永远卡住）
                if (task.getPayload() != null && task.getPayload().contains("processInstanceId")) {
                    try {
                        bridge.onTaskCompleted(task, Map.of("taskSuccess", false));
                    } catch (Exception e) {
                        log.error("[WorkflowTaskCompletionListener] Failed to signal workflow failure for task {}: {}",
                                task.getId(), e.getMessage(), e);
                    }
                }
            }
        }, () -> {
            log.warn("[WorkflowTaskCompletionListener] Failed task {} not found in database", event.getTaskInstanceId());
        });
    }

    private int getMaxRetries(String taskType) {
        return taskDefinitionRepository.findByCode(taskType)
                .map(TaskDefinition::getMaxRetries)
                .orElse(DEFAULT_MAX_RETRIES);
    }

    private Long parseLongSafe(String value) {
        if (value == null) return null;
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
