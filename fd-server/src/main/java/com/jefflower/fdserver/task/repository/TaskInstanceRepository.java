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

    @Modifying
    @Query("DELETE FROM TaskInstance t WHERE t.status IN :statuses AND t.completedAt < :cutoff")
    int deleteOldTasks(@Param("statuses") List<TaskStatus> statuses, @Param("cutoff") LocalDateTime cutoff);
}
