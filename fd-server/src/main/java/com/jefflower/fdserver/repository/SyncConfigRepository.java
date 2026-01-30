package com.jefflower.fdserver.repository;

import com.jefflower.fdserver.entity.SyncConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface SyncConfigRepository extends JpaRepository<SyncConfig, Long> {
    Optional<SyncConfig> findByConfigKey(String configKey);
}
