package com.jefflower.fdserver.ai.listener;

import com.jefflower.fdserver.ai.service.SyncAgentExecutionService;
import com.jefflower.fdserver.task.event.TaskCompletedEvent;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 监听 TaskCompletedEvent，将结果回调到 SyncAgentExecutionService 完成 CompletableFuture。
 * <p>
 * 仅处理 taskType 以 "agent." 开头的任务（通用 Agent 同步调用）。
 * 与 WorkflowTaskCompletionListener 互不干扰。
 * <p>
 * 使用 @Async + AFTER_COMMIT 确保任务状态已持久化后再读取 result。
 */
@Component
public class SyncTaskCompletionListener {

    private static final Logger log = LoggerFactory.getLogger(SyncTaskCompletionListener.class);

    private final SyncAgentExecutionService syncAgentService;
    private final TaskInstanceRepository taskInstanceRepository;

    public SyncTaskCompletionListener(SyncAgentExecutionService syncAgentService,
                                       TaskInstanceRepository taskInstanceRepository) {
        this.syncAgentService = syncAgentService;
        this.taskInstanceRepository = taskInstanceRepository;
        log.info("[SyncTaskCompletionListener] Initialized — listening for agent.* TaskCompletedEvent");
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onTaskCompleted(TaskCompletedEvent event) {
        String taskType = event.getTaskType();
        if (taskType == null || !taskType.startsWith("agent.")) {
            return; // 不是 Agent 同步任务，跳过
        }

        Long taskId = event.getTaskInstanceId();
        boolean success = event.isSuccess();

        log.debug("[SyncTaskCompletionListener] TaskCompletedEvent: taskId={}, type={}, success={}",
                taskId, taskType, success);

        if (success) {
            // 成功时需要从 DB 读取 task.result（event 中不携带成功结果）
            taskInstanceRepository.findById(taskId).ifPresentOrElse(task -> {
                String result = task.getResult();
                log.info("[SyncTaskCompletionListener] Task {} completed successfully, result length={}",
                        taskId, result != null ? result.length() : 0);
                syncAgentService.onTaskCompleted(taskId, true, result);
            }, () -> {
                log.warn("[SyncTaskCompletionListener] Task {} not found in DB after commit", taskId);
                syncAgentService.onTaskCompleted(taskId, false, "Task not found in database");
            });
        } else {
            // 失败时直接使用 event 中的 errorMessage
            syncAgentService.onTaskCompleted(taskId, false, event.getErrorMessage());
        }
    }
}
