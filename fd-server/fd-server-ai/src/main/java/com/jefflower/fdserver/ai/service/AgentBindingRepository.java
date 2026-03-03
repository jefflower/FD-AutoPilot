package com.jefflower.fdserver.ai.service;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface AgentBindingRepository extends JpaRepository<AgentBinding, String> {
    Optional<AgentBinding> findByCapability(String capability);
}
