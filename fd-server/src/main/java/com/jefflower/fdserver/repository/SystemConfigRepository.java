package com.jefflower.fdserver.repository;

import com.jefflower.fdserver.entity.SystemConfig;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SystemConfigRepository extends JpaRepository<SystemConfig, String> {
}
