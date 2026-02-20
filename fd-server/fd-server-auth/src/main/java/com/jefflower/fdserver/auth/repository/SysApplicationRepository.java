package com.jefflower.fdserver.auth.repository;

import com.jefflower.fdserver.auth.entity.SysApplication;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysApplicationRepository extends JpaRepository<SysApplication, Long> {
    Optional<SysApplication> findByCode(String code);
    boolean existsByCode(String code);
    List<SysApplication> findByEnabledTrue();
}
