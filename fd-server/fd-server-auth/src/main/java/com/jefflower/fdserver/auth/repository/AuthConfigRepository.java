package com.jefflower.fdserver.auth.repository;

import com.jefflower.fdserver.auth.entity.AuthConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AuthConfigRepository extends JpaRepository<AuthConfig, String> {
    List<AuthConfig> findByConfigKeyStartingWith(String prefix);
}
