package com.jefflower.fdserver.ai.repository;

import com.jefflower.fdserver.ai.entity.AiWorkflowWorkspace;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AiWorkflowWorkspaceRepository extends JpaRepository<AiWorkflowWorkspace, Long> {

    List<AiWorkflowWorkspace> findByWorkflowIdOrderBySortOrder(Long workflowId);

    void deleteByWorkflowIdAndId(Long workflowId, Long id);
}
