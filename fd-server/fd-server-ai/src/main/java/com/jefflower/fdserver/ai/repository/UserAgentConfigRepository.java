package com.jefflower.fdserver.ai.repository;

import com.jefflower.fdserver.ai.entity.UserAgentConfig;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UserAgentConfigRepository extends JpaRepository<UserAgentConfig, Long> {

    List<UserAgentConfig> findByUserId(String userId);

    Optional<UserAgentConfig> findByUserIdAndAgentCode(String userId, String agentCode);

    boolean existsByUserIdAndAgentCode(String userId, String agentCode);

    void deleteByUserIdAndAgentCode(String userId, String agentCode);
}
