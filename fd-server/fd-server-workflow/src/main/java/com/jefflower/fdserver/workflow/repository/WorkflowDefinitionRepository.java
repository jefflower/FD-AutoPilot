package com.jefflower.fdserver.workflow.repository;

import com.jefflower.fdserver.workflow.entity.WorkflowDefinition;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface WorkflowDefinitionRepository extends JpaRepository<WorkflowDefinition, Long> {

    Optional<WorkflowDefinition> findByProcessKey(String processKey);

    boolean existsByProcessKey(String processKey);

    List<WorkflowDefinition> findByBusinessTypeAndEnabledTrue(String businessType);

    List<WorkflowDefinition> findAllByOrderByCreatedAtDesc();
}
