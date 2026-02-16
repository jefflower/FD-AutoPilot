package com.jefflower.fdserver.task.service;

import com.jefflower.fdserver.task.entity.TaskDefinition;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.enums.TriggerType;
import com.jefflower.fdserver.task.repository.TaskDefinitionRepository;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class TaskDistributionService {

    private final TaskInstanceRepository taskInstanceRepository;
    private final TaskDefinitionRepository taskDefinitionRepository;

    /**
     * 创建任务（幂等：同 taskType + referenceId 已有 PENDING/CLAIMED 则跳过）
     */
    @Transactional
    public TaskInstance createTask(String taskType, String referenceType, String referenceId,
                                  String payload, TriggerType triggerType) {
        if (referenceId != null) {
            Optional<TaskInstance> existing = taskInstanceRepository
                    .findByTaskTypeAndReferenceIdAndStatusIn(taskType, referenceId,
                            List.of(TaskStatus.PENDING, TaskStatus.CLAIMED));
            if (existing.isPresent()) {
                log.debug("Task already exists for type={} refId={}, skipping", taskType, referenceId);
                return existing.get();
            }
        }

        TaskInstance instance = new TaskInstance();
        instance.setTaskType(taskType);
        instance.setReferenceType(referenceType);
        instance.setReferenceId(referenceId);
        instance.setPayload(payload);
        instance.setTriggerType(triggerType != null ? triggerType : TriggerType.EVENT);
        instance.setStatus(TaskStatus.PENDING);
        instance.setCreatedAt(LocalDateTime.now());

        TaskInstance saved = taskInstanceRepository.save(instance);
        log.info("Created task instance: id={}, type={}, refType={}, refId={}",
                saved.getId(), taskType, referenceType, referenceId);
        return saved;
    }

    /**
     * 领取任务
     * - 优先返回此客户端已 CLAIMED 的任务
     * - 检查 maxConcurrency 限制
     * - 查询 PENDING 任务并原子分配
     */
    @Transactional
    public List<TaskInstance> claimTasks(String taskType, String clientId, int limit) {
        // 1. 先返回此客户端已领取的任务
        List<TaskInstance> alreadyClaimed = taskInstanceRepository
                .findByAssignedToAndStatusIn(clientId, List.of(TaskStatus.CLAIMED));
        List<TaskInstance> claimedForType = alreadyClaimed.stream()
                .filter(t -> t.getTaskType().equals(taskType))
                .collect(Collectors.toList());
        if (!claimedForType.isEmpty()) {
            log.debug("Client {} already has {} claimed tasks for type {}", clientId, claimedForType.size(), taskType);
            return claimedForType;
        }

        // 2. 检查 maxConcurrency
        Optional<TaskDefinition> defOpt = taskDefinitionRepository.findByCode(taskType);
        if (defOpt.isPresent()) {
            TaskDefinition def = defOpt.get();
            if (!def.isEnabled()) {
                log.warn("Task type {} is disabled", taskType);
                return Collections.emptyList();
            }
            long currentClaimed = taskInstanceRepository.countByAssignedToAndStatus(clientId, TaskStatus.CLAIMED);
            if (currentClaimed >= def.getMaxConcurrency()) {
                log.debug("Client {} reached max concurrency {} for type {}", clientId, def.getMaxConcurrency(), taskType);
                return Collections.emptyList();
            }
            limit = Math.min(limit, def.getMaxConcurrency() - (int) currentClaimed);
        }

        // 3. 查询 PENDING 任务并分配
        List<TaskInstance> pendingTasks = taskInstanceRepository
                .findPendingTasks(taskType, TaskStatus.PENDING, PageRequest.of(0, limit));
        if (pendingTasks.isEmpty()) {
            return Collections.emptyList();
        }

        LocalDateTime now = LocalDateTime.now();
        for (TaskInstance task : pendingTasks) {
            task.setStatus(TaskStatus.CLAIMED);
            task.setAssignedTo(clientId);
            task.setAssignedAt(now);
            task.setStartedAt(now);
        }
        taskInstanceRepository.saveAll(pendingTasks);

        log.info("Client {} claimed {} tasks for type {}", clientId, pendingTasks.size(), taskType);
        return pendingTasks;
    }

    /**
     * 完成任务
     */
    @Transactional
    public void completeTask(Long taskId, String clientId, boolean success, String resultOrError) {
        TaskInstance task = taskInstanceRepository.findById(taskId)
                .orElseThrow(() -> new IllegalArgumentException("Task not found: " + taskId));

        if (!clientId.equals(task.getAssignedTo())) {
            throw new IllegalStateException("Task " + taskId + " is not assigned to client " + clientId);
        }

        LocalDateTime now = LocalDateTime.now();
        if (success) {
            task.setStatus(TaskStatus.COMPLETED);
            task.setResult(resultOrError);
        } else {
            task.setStatus(TaskStatus.FAILED);
            task.setErrorMessage(resultOrError);
        }
        task.setCompletedAt(now);
        taskInstanceRepository.save(task);

        log.info("Task {} completed by client {}: success={}", taskId, clientId, success);
    }

    /**
     * 通过业务引用完成任务（供业务模块调用）
     */
    @Transactional
    public void completeByReference(String taskType, String referenceId) {
        int updated = taskInstanceRepository.completeByReference(
                taskType, referenceId, TaskStatus.COMPLETED, LocalDateTime.now(),
                List.of(TaskStatus.PENDING, TaskStatus.CLAIMED));
        if (updated > 0) {
            log.info("Completed {} tasks by reference: type={}, refId={}", updated, taskType, referenceId);
        }
    }

    /**
     * 释放任务（回到 PENDING）
     */
    @Transactional
    public void releaseTask(Long taskId, String clientId) {
        TaskInstance task = taskInstanceRepository.findById(taskId)
                .orElseThrow(() -> new IllegalArgumentException("Task not found: " + taskId));

        if (!clientId.equals(task.getAssignedTo())) {
            throw new IllegalStateException("Task " + taskId + " is not assigned to client " + clientId);
        }

        task.setStatus(TaskStatus.PENDING);
        task.setAssignedTo(null);
        task.setAssignedAt(null);
        task.setStartedAt(null);
        taskInstanceRepository.save(task);

        log.info("Task {} released by client {}", taskId, clientId);
    }

    /**
     * 获取客户端的任务列表
     */
    public List<TaskInstance> getMyTasks(String clientId) {
        return taskInstanceRepository.findByAssignedToAndStatusIn(
                clientId, List.of(TaskStatus.CLAIMED, TaskStatus.PENDING));
    }

    /**
     * 获取仪表盘统计数据
     */
    public Map<String, Map<String, Long>> getDashboardStats() {
        List<Object[]> rows = taskInstanceRepository.countByTaskTypeAndStatus();
        Map<String, Map<String, Long>> result = new LinkedHashMap<>();
        for (Object[] row : rows) {
            String taskType = (String) row[0];
            TaskStatus status = (TaskStatus) row[1];
            Long count = (Long) row[2];
            result.computeIfAbsent(taskType, k -> new LinkedHashMap<>())
                    .put(status.name(), count);
        }
        return result;
    }
}
