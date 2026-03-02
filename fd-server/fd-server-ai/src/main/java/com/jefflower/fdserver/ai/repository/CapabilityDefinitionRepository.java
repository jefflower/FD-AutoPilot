package com.jefflower.fdserver.ai.repository;

import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CapabilityDefinitionRepository extends JpaRepository<CapabilityDefinition, Long> {

    Optional<CapabilityDefinition> findByCode(String code);

    List<CapabilityDefinition> findByEnabledTrueOrderBySortOrder();

    List<CapabilityDefinition> findAllByOrderBySortOrder();

    boolean existsByCode(String code);
}
