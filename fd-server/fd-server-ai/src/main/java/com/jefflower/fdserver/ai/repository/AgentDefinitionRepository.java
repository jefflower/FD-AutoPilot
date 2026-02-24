package com.jefflower.fdserver.ai.repository;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AgentDefinitionRepository extends JpaRepository<AgentDefinition, Long> {

    Optional<AgentDefinition> findByCode(String code);

    boolean existsByCode(String code);

    List<AgentDefinition> findByEnabledTrueOrderBySortOrder();

    List<AgentDefinition> findByCapabilityAndEnabledTrueOrderBySortOrder(String capability);

    List<AgentDefinition> findAllByOrderBySortOrder();

    List<AgentDefinition> findByGroupCodeAndEnabledTrueOrderBySortOrder(String groupCode);
}
