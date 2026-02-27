package com.jefflower.fdserver.task.scheduler;

import com.jefflower.fdserver.task.entity.TaskDefinition;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.ExecutionMode;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.repository.TaskDefinitionRepository;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class TaskRecoveryScheduler {

    /** FAILED 任务冷却时间（秒）：防止快速失败循环 */
    private static final int FAILED_COOLDOWN_SECONDS = 60;

    private final TaskDefinitionRepository taskDefinitionRepository;
    private final TaskInstanceRepository taskInstanceRepository;

    /**
     * 每 30 秒扫描超时任务（CLAIMED 状态超时未完成）
     */
    @Scheduled(fixedDelay = 30000)
    @Transactional
    public void recoverTimeoutTasks() {
        List<TaskDefinition> definitions = taskDefinitionRepository
                .findByEnabledAndExecutionMode(true, ExecutionMode.CLIENT_DISTRIBUTED);

        for (TaskDefinition def : definitions) {
            LocalDateTime cutoff = LocalDateTime.now().minusSeconds(def.getTimeoutSeconds());
            List<TaskInstance> timeoutTasks = taskInstanceRepository
                    .findTimeoutTasks(def.getCode(), TaskStatus.CLAIMED, cutoff);

            for (TaskInstance task : timeoutTasks) {
                if (task.getRetryCount() < def.getMaxRetries()) {
                    resetToPending(task, def.getMaxRetries(), "timeout");
                } else {
                    markPermanentlyFailed(task, def.getMaxRetries(), "timeout");
                }
            }
        }
    }

    /**
     * 每 60 秒扫描 FAILED 状态任务（兜底恢复：WorkflowTaskCompletionListener 主路径未能重置的情况）
     * <p>
     * 冷却 60 秒后，若未超重试上限则重置为 PENDING；已超限则标记为 TIMEOUT。
     */
    @Scheduled(fixedDelay = 60000)
    @Transactional
    public void recoverFailedTasks() {
        List<TaskDefinition> definitions = taskDefinitionRepository
                .findByEnabledAndExecutionMode(true, ExecutionMode.CLIENT_DISTRIBUTED);

        for (TaskDefinition def : definitions) {
            LocalDateTime cooldownCutoff = LocalDateTime.now().minusSeconds(FAILED_COOLDOWN_SECONDS);
            List<TaskInstance> failedTasks = taskInstanceRepository
                    .findFailedTasksForRecovery(def.getCode(), TaskStatus.FAILED, cooldownCutoff);

            for (TaskInstance task : failedTasks) {
                if (task.getRetryCount() < def.getMaxRetries()) {
                    resetToPending(task, def.getMaxRetries(), "failed-recovery");
                } else {
                    markPermanentlyFailed(task, def.getMaxRetries(), "failed-recovery");
                }
            }
        }
    }

    private void resetToPending(TaskInstance task, int maxRetries, String source) {
        task.setStatus(TaskStatus.PENDING);
        task.setAssignedTo(null);
        task.setAssignedAt(null);
        task.setStartedAt(null);
        task.setCompletedAt(null);
        task.setRetryCount(task.getRetryCount() + 1);
        taskInstanceRepository.save(task);
        log.warn("[TaskRecovery] Task {} ({}) retry {}/{}, reset to PENDING",
                task.getId(), source, task.getRetryCount(), maxRetries);
    }

    private void markPermanentlyFailed(TaskInstance task, int maxRetries, String source) {
        task.setStatus(TaskStatus.TIMEOUT);
        task.setErrorMessage("Exceeded max retries (" + maxRetries + ") due to " + source);
        task.setCompletedAt(LocalDateTime.now());
        taskInstanceRepository.save(task);
        log.error("[TaskRecovery] Task {} ({}) permanently failed after {} retries",
                task.getId(), source, maxRetries);
    }
}
