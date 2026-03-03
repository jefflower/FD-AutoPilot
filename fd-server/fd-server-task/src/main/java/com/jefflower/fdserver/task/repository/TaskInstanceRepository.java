package com.jefflower.fdserver.task.repository;

import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface TaskInstanceRepository extends JpaRepository<TaskInstance, Long> {

    List<TaskInstance> findByTaskTypeAndStatus(String taskType, TaskStatus status);

    List<TaskInstance> findByAssignedToAndStatusIn(String assignedTo, List<TaskStatus> statuses);

    Optional<TaskInstance> findByTaskTypeAndReferenceIdAndStatusIn(String taskType, String referenceId, List<TaskStatus> statuses);

    @Query("SELECT t FROM TaskInstance t WHERE t.taskType = :taskType AND t.status = :status ORDER BY t.createdAt ASC")
    List<TaskInstance> findPendingTasks(@Param("taskType") String taskType, @Param("status") TaskStatus status, Pageable pageable);

    @Query("SELECT t FROM TaskInstance t WHERE t.taskType = :taskType AND t.status = :status AND t.assignedAt < :cutoff")
    List<TaskInstance> findTimeoutTasks(@Param("taskType") String taskType, @Param("status") TaskStatus status, @Param("cutoff") LocalDateTime cutoff);

    @Query("SELECT t.taskType, t.status, COUNT(t) FROM TaskInstance t GROUP BY t.taskType, t.status")
    List<Object[]> countByTaskTypeAndStatus();

    @Modifying
    @Query("UPDATE TaskInstance t SET t.status = :newStatus, t.completedAt = :now WHERE t.taskType = :taskType AND t.referenceId = :refId AND t.status IN :oldStatuses")
    int completeByReference(@Param("taskType") String taskType,
                            @Param("refId") String refId,
                            @Param("newStatus") TaskStatus newStatus,
                            @Param("now") LocalDateTime now,
                            @Param("oldStatuses") List<TaskStatus> oldStatuses);

    Page<TaskInstance> findByTaskTypeOrderByCreatedAtDesc(String taskType, Pageable pageable);

    Page<TaskInstance> findAllByOrderByCreatedAtDesc(Pageable pageable);

    long countByAssignedToAndStatus(String assignedTo, TaskStatus status);

    long countByAssignedToAndStatusAndTaskType(String assignedTo, TaskStatus status, String taskType);

    long countByTaskTypeAndStatusIn(String taskType, List<TaskStatus> statuses);

    @Modifying
    @Query("DELETE FROM TaskInstance t WHERE t.status IN :statuses AND t.completedAt < :cutoff")
    int deleteOldTasks(@Param("statuses") List<TaskStatus> statuses, @Param("cutoff") LocalDateTime cutoff);

    /**
     * 查找最近完成的任务（防止短时间内重复创建，debounce）
     */
    @Query("SELECT t FROM TaskInstance t WHERE t.taskType = :taskType AND t.referenceId = :refId AND t.status = :status AND t.completedAt > :cutoff ORDER BY t.completedAt DESC")
    Optional<TaskInstance> findRecentlyCompletedTask(@Param("taskType") String taskType,
                                                     @Param("refId") String refId,
                                                     @Param("status") TaskStatus status,
                                                     @Param("cutoff") LocalDateTime cutoff);

    /**
     * 取消同 taskType + referenceId 下、除指定任务外的所有活跃任务（PENDING + CLAIMED），防止重复处理。
     * 包含 CLAIMED 是因为竞态条件：消费者可能在取消前已 claim 了新的重复任务。
     */
    @Modifying
    @Query("UPDATE TaskInstance t SET t.status = :cancelStatus, t.completedAt = :now WHERE t.taskType = :taskType AND t.referenceId = :refId AND t.status IN :activeStatuses AND t.id <> :excludeId")
    int cancelDuplicateActiveTasks(@Param("taskType") String taskType,
                                   @Param("refId") String refId,
                                   @Param("activeStatuses") List<TaskStatus> activeStatuses,
                                   @Param("cancelStatus") TaskStatus cancelStatus,
                                   @Param("now") LocalDateTime now,
                                   @Param("excludeId") Long excludeId);

    /**
     * 查找已失败且冷却时间已过的任务（兜底恢复用）
     */
    @Query("SELECT t FROM TaskInstance t WHERE t.taskType = :taskType AND t.status = :status AND t.completedAt < :cutoff")
    List<TaskInstance> findFailedTasksForRecovery(@Param("taskType") String taskType, @Param("status") TaskStatus status, @Param("cutoff") LocalDateTime cutoff);

    /**
     * 查找 payload 中包含指定 processInstanceId 且状态在指定范围内的任务。
     * 用于工作流超时恢复：找出已完成/超时但 ReceiveTask 信号丢失的任务。
     */
    @Query("SELECT t FROM TaskInstance t WHERE t.payload LIKE CONCAT('%', :processInstanceId, '%') AND t.status IN :statuses")
    List<TaskInstance> findByPayloadContainingAndStatusIn(
            @Param("processInstanceId") String processInstanceId,
            @Param("statuses") List<TaskStatus> statuses);
}
