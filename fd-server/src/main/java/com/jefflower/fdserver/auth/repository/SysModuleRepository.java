package com.jefflower.fdserver.auth.repository;

import com.jefflower.fdserver.auth.entity.SysModule;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface SysModuleRepository extends JpaRepository<SysModule, Long> {
    Optional<SysModule> findByCode(String code);
    boolean existsByCode(String code);
    List<SysModule> findByEnabledTrueOrderBySortOrderAsc();

    @Query("SELECT DISTINCT p.module FROM SysPermission p " +
           "JOIN SysRolePermission rp ON rp.permissionId = p.id " +
           "JOIN SysUserRole ur ON ur.roleId = rp.roleId " +
           "WHERE ur.userId = :userId")
    List<String> findModuleCodesByUserId(Long userId);
}
