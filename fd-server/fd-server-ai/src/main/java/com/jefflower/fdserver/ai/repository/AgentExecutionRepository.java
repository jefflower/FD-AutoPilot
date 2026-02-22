package com.jefflower.fdserver.ai.repository;

import com.jefflower.fdserver.ai.entity.AgentExecution;
import com.jefflower.fdserver.ai.enums.ExecutionStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;

public interface AgentExecutionRepository extends JpaRepository<AgentExecution, Long> {

    Page<AgentExecution> findByAgentCodeOrderByCreatedAtDesc(String agentCode, Pageable pageable);

    Page<AgentExecution> findAllByOrderByCreatedAtDesc(Pageable pageable);

    long countByAgentCodeAndStatus(String agentCode, ExecutionStatus status);

    long countByAgentCode(String agentCode);

    @Query("SELECT AVG(e.durationMs) FROM AgentExecution e WHERE e.agentCode = :code AND e.status = 'SUCCESS' AND e.durationMs IS NOT NULL")
    Double findAvgDurationByAgentCode(@Param("code") String agentCode);

    long countByAgentCodeAndCreatedAtAfter(String agentCode, LocalDateTime after);

    void deleteByCreatedAtBefore(LocalDateTime before);
}
