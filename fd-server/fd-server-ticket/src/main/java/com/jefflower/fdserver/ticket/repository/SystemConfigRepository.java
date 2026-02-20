package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.SystemConfig;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SystemConfigRepository extends JpaRepository<SystemConfig, String> {
}
