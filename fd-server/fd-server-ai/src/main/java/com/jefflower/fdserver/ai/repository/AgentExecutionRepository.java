package com.jefflower.fdserver.ai.repository;

import com.jefflower.fdserver.ai.entity.AgentExecution;
import com.jefflower.fdserver.ai.enums.ExecutionStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface AgentExecutionRepository extends JpaRepository<AgentExecution, Long> {

    Page<AgentExecution> findByAgentCodeOrderByCreatedAtDesc(String agentCode, Pageable pageable);

    Page<AgentExecution> findAllByOrderByCreatedAtDesc(Pageable pageable);

    long countByAgentCodeAndStatus(String agentCode, ExecutionStatus status);

    long countByAgentCode(String agentCode);

    @Query("SELECT AVG(e.durationMs) FROM AgentExecution e WHERE e.agentCode = :code AND e.status = 'SUCCESS' AND e.durationMs IS NOT NULL")
    Double findAvgDurationByAgentCode(@Param("code") String agentCode);

    long countByAgentCodeAndCreatedAtAfter(String agentCode, LocalDateTime after);

    void deleteByCreatedAtBefore(LocalDateTime before);

    // --- 导出用查询方法 ---

    List<AgentExecution> findByCreatedAtAfterOrderByCreatedAtDesc(LocalDateTime cutoff);

    List<AgentExecution> findByAgentCodeAndCreatedAtAfterOrderByCreatedAtDesc(String agentCode, LocalDateTime cutoff);

    List<AgentExecution> findByStatusAndCreatedAtAfterOrderByCreatedAtDesc(ExecutionStatus status, LocalDateTime cutoff);

    List<AgentExecution> findByAgentCodeAndStatusAndCreatedAtAfterOrderByCreatedAtDesc(
            String agentCode, ExecutionStatus status, LocalDateTime cutoff);
}
