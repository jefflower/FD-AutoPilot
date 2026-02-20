package com.jefflower.fdserver.auth.repository;

import com.jefflower.fdserver.auth.entity.SysRole;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface SysRoleRepository extends JpaRepository<SysRole, Long> {
    Optional<SysRole> findByCode(String code);
    boolean existsByCode(String code);
}
