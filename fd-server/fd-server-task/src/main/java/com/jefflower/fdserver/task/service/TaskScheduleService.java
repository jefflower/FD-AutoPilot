package com.jefflower.fdserver.task.service;

import com.jefflower.fdserver.task.entity.TaskDefinition;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.ExecutionMode;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.enums.TriggerType;
import com.jefflower.fdserver.task.repository.TaskDefinitionRepository;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Slf4j
@Service
@RequiredArgsConstructor
public class TaskScheduleService {

    private final TaskInstanceRepository taskInstanceRepository;
    private final TaskDefinitionRepository taskDefinitionRepository;
    private final ApplicationContext applicationContext;

    /**
     * 执行定时任务（SERVER_SCHEDULED 模式）
     */
    @Transactional
    public void executeScheduledTask(TaskDefinition def) {
        log.info("Executing scheduled task: code={}, handler={}", def.getCode(), def.getHandlerName());

        TaskInstance instance = new TaskInstance();
        instance.setTaskType(def.getCode());
        instance.setStatus(TaskStatus.CLAIMED);
        instance.setTriggerType(TriggerType.SCHEDULED);
        instance.setAssignedTo("server");
        instance.setAssignedAt(LocalDateTime.now());
        instance.setStartedAt(LocalDateTime.now());
        instance.setCreatedAt(LocalDateTime.now());
        taskInstanceRepository.save(instance);

        try {
            TaskHandler handler = applicationContext.getBean(def.getHandlerName(), TaskHandler.class);
            String result = handler.execute(instance);
            instance.setStatus(TaskStatus.COMPLETED);
            instance.setResult(result);
            instance.setCompletedAt(LocalDateTime.now());
            log.info("Scheduled task completed: code={}, instanceId={}", def.getCode(), instance.getId());
        } catch (Exception e) {
            instance.setStatus(TaskStatus.FAILED);
            instance.setErrorMessage(e.getMessage());
            instance.setCompletedAt(LocalDateTime.now());
            log.error("Scheduled task failed: code={}, instanceId={}", def.getCode(), instance.getId(), e);
        }
        taskInstanceRepository.save(instance);
    }

    /**
     * 手动触发任务
     * - CLIENT_DISTRIBUTED: 创建 PENDING 实例等待客户端领取
     * - SERVER_*: 直接执行
     */
    @Transactional
    public TaskInstance triggerTask(String taskCode) {
        TaskDefinition def = taskDefinitionRepository.findByCode(taskCode)
                .orElseThrow(() -> new IllegalArgumentException("Task definition not found: " + taskCode));

        if (def.getExecutionMode() == ExecutionMode.CLIENT_DISTRIBUTED) {
            TaskInstance instance = new TaskInstance();
            instance.setTaskType(def.getCode());
            instance.setStatus(TaskStatus.PENDING);
            instance.setTriggerType(TriggerType.MANUAL);
            instance.setCreatedAt(LocalDateTime.now());
            TaskInstance saved = taskInstanceRepository.save(instance);
            log.info("Created PENDING task for client distribution: code={}, instanceId={}", taskCode, saved.getId());
            return saved;
        } else {
            // SERVER_SCHEDULED or SERVER_TRIGGERED: 直接执行
            executeScheduledTask(def);
            // 返回最新创建的实例
            return taskInstanceRepository.findByTaskTypeOrderByCreatedAtDesc(taskCode,
                    org.springframework.data.domain.PageRequest.of(0, 1)).getContent().stream()
                    .findFirst().orElse(null);
        }
    }
}
