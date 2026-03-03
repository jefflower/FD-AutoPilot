package com.jefflower.fdserver.ai.repository;

import com.jefflower.fdserver.ai.entity.AiWorkflowVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiWorkflowVersionRepository extends JpaRepository<AiWorkflowVersion, Long> {

    List<AiWorkflowVersion> findByWorkflowIdOrderByVersionNumberDesc(Long workflowId);

    Optional<AiWorkflowVersion> findByWorkflowIdAndVersionNumber(Long workflowId, int versionNumber);

    long countByWorkflowId(Long workflowId);
}
