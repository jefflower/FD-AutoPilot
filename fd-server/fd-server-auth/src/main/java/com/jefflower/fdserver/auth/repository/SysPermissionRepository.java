package com.jefflower.fdserver.auth.repository;

import com.jefflower.fdserver.auth.entity.SysPermission;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface SysPermissionRepository extends JpaRepository<SysPermission, Long> {
    Optional<SysPermission> findByCode(String code);
    List<SysPermission> findByModule(String module);
    boolean existsByCode(String code);
}
