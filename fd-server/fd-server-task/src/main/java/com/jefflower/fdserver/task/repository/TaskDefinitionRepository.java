package com.jefflower.fdserver.task.repository;

import com.jefflower.fdserver.task.entity.TaskDefinition;
import com.jefflower.fdserver.task.enums.ExecutionMode;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TaskDefinitionRepository extends JpaRepository<TaskDefinition, Long> {

    Optional<TaskDefinition> findByCode(String code);

    List<TaskDefinition> findByEnabled(boolean enabled);

    List<TaskDefinition> findByExecutionMode(ExecutionMode executionMode);

    List<TaskDefinition> findByEnabledAndExecutionMode(boolean enabled, ExecutionMode executionMode);
}
