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

    private final TaskDefinitionRepository taskDefinitionRepository;
    private final TaskInstanceRepository taskInstanceRepository;

    /**
     * 每 30 秒扫描超时任务
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
                    // 回到 PENDING，等待重新领取
                    task.setStatus(TaskStatus.PENDING);
                    task.setAssignedTo(null);
                    task.setAssignedAt(null);
                    task.setStartedAt(null);
                    task.setRetryCount(task.getRetryCount() + 1);
                    taskInstanceRepository.save(task);
                    log.warn("Task {} timed out, retry {}/{}, reset to PENDING",
                            task.getId(), task.getRetryCount(), def.getMaxRetries());
                } else {
                    // 超过最大重试次数，标记为 TIMEOUT
                    task.setStatus(TaskStatus.TIMEOUT);
                    task.setErrorMessage("Exceeded max retries (" + def.getMaxRetries() + ") due to timeout");
                    task.setCompletedAt(LocalDateTime.now());
                    taskInstanceRepository.save(task);
                    log.error("Task {} permanently timed out after {} retries", task.getId(), def.getMaxRetries());
                }
            }
        }
    }
}
