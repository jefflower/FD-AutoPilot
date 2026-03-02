package com.jefflower.fdserver.ai.repository;

import com.jefflower.fdserver.ai.entity.AiWorkflow;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiWorkflowRepository extends JpaRepository<AiWorkflow, Long> {

    List<AiWorkflow> findByCreatedBy(String createdBy);

    List<AiWorkflow> findAllByOrderByCreatedAtDesc();

    Optional<AiWorkflow> findByN8nWorkflowId(String n8nWorkflowId);
}
