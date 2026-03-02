package com.jefflower.fdserver.task.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.task.entity.TaskDefinition;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.enums.TriggerType;
import com.jefflower.fdserver.task.repository.TaskDefinitionRepository;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import com.jefflower.fdserver.task.event.TaskCompletedEvent;
import com.jefflower.fdserver.task.event.TaskPushEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
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
    private final ApplicationEventPublisher eventPublisher;

    /**
     * 创建任务（幂等：同 taskType + referenceId 已有活跃或最近完成的任务则跳过）
     */
    @Transactional
    public TaskInstance createTask(String taskType, String referenceType, String referenceId,
                                  String payload, TriggerType triggerType) {
        if (referenceId != null) {
            // 1. 检查 PENDING/CLAIMED 活跃任务
            Optional<TaskInstance> existing = taskInstanceRepository
                    .findByTaskTypeAndReferenceIdAndStatusIn(taskType, referenceId,
                            List.of(TaskStatus.PENDING, TaskStatus.CLAIMED));
            if (existing.isPresent()) {
                log.debug("Task already exists for type={} refId={}, skipping", taskType, referenceId);
                return existing.get();
            }
            // 2. 检查最近 5 分钟内 COMPLETED 的任务（防止工作流重复触发导致循环创建）
            Optional<TaskInstance> recentlyCompleted = taskInstanceRepository
                    .findRecentlyCompletedTask(taskType, referenceId, TaskStatus.COMPLETED,
                            LocalDateTime.now().minusMinutes(5));
            if (recentlyCompleted.isPresent()) {
                log.warn("Task type={} refId={} was COMPLETED recently (id={}), skipping re-creation (debounce)",
                        taskType, referenceId, recentlyCompleted.get().getId());
                return recentlyCompleted.get();
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

        // 发布任务创建事件 → SSE 推送给客户端
        Long refIdLong = null;
        try {
            if (referenceId != null) refIdLong = Long.parseLong(referenceId);
        } catch (NumberFormatException ignored) {
        }
        eventPublisher.publishEvent(new TaskPushEvent(
                this, taskType, saved.getId(), referenceType, refIdLong, null));

        return saved;
    }

    /**
     * 创建任务（带路由目标参数重载）
     */
    @Transactional
    public TaskInstance createTask(String taskType, String referenceType, String referenceId,
                                   String payload, TriggerType triggerType,
                                   String targetClientId, String targetUserId) {
        TaskInstance instance = createTask(taskType, referenceType, referenceId, payload, triggerType);
        if (targetClientId != null || targetUserId != null) {
            instance.setTargetClientId(targetClientId);
            instance.setTargetUserId(targetUserId);
            taskInstanceRepository.save(instance);
        }
        return instance;
    }

    /**
     * 领取任务（兼容旧签名）
     */
    @Transactional
    public List<TaskInstance> claimTasks(String taskType, String clientId, int limit) {
        return claimTasks(taskType, clientId, null, limit);
    }

    /**
     * 领取任务（带 userId 路由过滤）
     * - 优先返回此客户端已 CLAIMED 的任务
     * - 检查 maxConcurrency 限制
     * - 查询 PENDING 任务并原子分配
     * - 路由过滤：targetClientId 为 null 或等于当前 clientId；targetUserId 为 null 或等于当前 userId
     */
    @Transactional
    public List<TaskInstance> claimTasks(String taskType, String clientId, String userId, int limit) {
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
            long currentClaimed = taskInstanceRepository.countByAssignedToAndStatusAndTaskType(clientId, TaskStatus.CLAIMED, taskType);
            if (currentClaimed >= def.getMaxConcurrency()) {
                log.debug("Client {} reached max concurrency {} for type {}", clientId, def.getMaxConcurrency(), taskType);
                return Collections.emptyList();
            }
            limit = Math.min(limit, def.getMaxConcurrency() - (int) currentClaimed);
        }

        // 3. 查询 PENDING 任务并分配
        List<TaskInstance> pendingTasks = taskInstanceRepository
                .findPendingTasks(taskType, TaskStatus.PENDING, PageRequest.of(0, limit * 3));
        if (pendingTasks.isEmpty()) {
            return Collections.emptyList();
        }

        // 4. 按路由规则过滤（targetClientId / targetUserId）
        List<TaskInstance> filteredTasks = new ArrayList<>();
        for (TaskInstance task : pendingTasks) {
            if (filteredTasks.size() >= limit) break;

            // 路由过滤：targetClientId 为 null 或等于当前 clientId
            if (task.getTargetClientId() != null && !task.getTargetClientId().equals(clientId)) {
                continue;
            }
            // 路由过滤：targetUserId 为 null 或等于当前 userId（如果 userId 不为 null）
            if (task.getTargetUserId() != null && userId != null && !task.getTargetUserId().equals(userId)) {
                continue;
            }

            filteredTasks.add(task);
        }
        if (filteredTasks.isEmpty()) {
            return Collections.emptyList();
        }

        LocalDateTime now = LocalDateTime.now();
        for (TaskInstance task : filteredTasks) {
            task.setStatus(TaskStatus.CLAIMED);
            task.setAssignedTo(clientId);
            task.setAssignedAt(now);
            task.setStartedAt(now);
        }
        taskInstanceRepository.saveAll(filteredTasks);

        log.info("Client {} claimed {} tasks for type {}", clientId, filteredTasks.size(), taskType);
        return filteredTasks;
    }

    /**
     * 完成任务
     */
    @Transactional
    public void completeTask(Long taskId, String clientId, boolean success, String resultOrError) {
        TaskInstance task = taskInstanceRepository.findById(taskId)
                .orElseThrow(() -> new BusinessException(ErrorCode.TASK_NOT_FOUND, "Task not found: " + taskId));

        // 终态幂等：已完成/已失败/已超时/已取消 → 静默跳过
        if (task.getStatus() == TaskStatus.COMPLETED || task.getStatus() == TaskStatus.FAILED
                || task.getStatus() == TaskStatus.TIMEOUT || task.getStatus() == TaskStatus.CANCELLED) {
            log.debug("Task {} already in terminal status {}, ignoring complete (success={})", taskId, task.getStatus(), success);
            return;
        }

        // PENDING 状态：claim 状态丢失（服务器重启/Recovery 回退），但消费者已完成工作，强制完成
        if (task.getStatus() == TaskStatus.PENDING) {
            log.warn("Task {} in PENDING but client {} reports completion (success={}). " +
                    "Claim state may have been lost (server restart / recovery reset). Force-completing.",
                    taskId, clientId, success);
            task.setAssignedTo(clientId);
            task.setAssignedAt(LocalDateTime.now());
        }

        // CLAIMED 状态：正常流程，验证 ownership
        // clientId 为 null 时（如 SyncBridge 超时强制取消），跳过 ownership 检查
        if (task.getStatus() == TaskStatus.CLAIMED && clientId != null && !clientId.equals(task.getAssignedTo())) {
            throw new BusinessException(ErrorCode.TASK_NOT_OWNED, "Task " + taskId + " is not assigned to client " + clientId);
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

        // 成功完成时，取消同 type+referenceId 的其他活跃任务（PENDING + CLAIMED），防止重复处理
        // 包含 CLAIMED 是因为消费者可能在取消执行前已 claim 了重复任务（竞态条件）
        if (success && task.getReferenceId() != null) {
            int cancelled = taskInstanceRepository.cancelDuplicateActiveTasks(
                    task.getTaskType(), task.getReferenceId(),
                    List.of(TaskStatus.PENDING, TaskStatus.CLAIMED), TaskStatus.CANCELLED, now, taskId);
            if (cancelled > 0) {
                log.info("Cancelled {} duplicate active tasks for type={}, refId={}",
                        cancelled, task.getTaskType(), task.getReferenceId());
            }
        }

        // 发布任务完成事件 → SSE 通知客户端 + 工作流桥接
        eventPublisher.publishEvent(new TaskCompletedEvent(
                this, taskId, task.getTaskType(), success, clientId,
                success ? null : resultOrError));
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
                .orElseThrow(() -> new BusinessException(ErrorCode.TASK_NOT_FOUND, "Task not found: " + taskId));

        if (!clientId.equals(task.getAssignedTo())) {
            throw new BusinessException(ErrorCode.TASK_NOT_OWNED, "Task " + taskId + " is not assigned to client " + clientId);
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
     * 按任务类型和状态列表统计任务数量
     */
    public long countByTypeAndStatuses(String taskType, List<TaskStatus> statuses) {
        return taskInstanceRepository.countByTaskTypeAndStatusIn(taskType, statuses);
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
