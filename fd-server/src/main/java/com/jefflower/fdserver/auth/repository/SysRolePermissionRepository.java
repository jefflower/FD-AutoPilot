package com.jefflower.fdserver.auth.repository;

import com.jefflower.fdserver.auth.entity.SysRolePermission;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;

public interface SysRolePermissionRepository extends JpaRepository<SysRolePermission, Long> {
    List<SysRolePermission> findByRoleId(Long roleId);
    void deleteByRoleId(Long roleId);

    @Query("SELECT DISTINCT p.code FROM SysRolePermission rp " +
           "JOIN SysPermission p ON rp.permissionId = p.id " +
           "WHERE rp.roleId IN :roleIds")
    List<String> findPermissionCodesByRoleIds(List<Long> roleIds);

    @Query("SELECT DISTINCT p.code FROM SysRolePermission rp " +
           "JOIN SysPermission p ON rp.permissionId = p.id " +
           "JOIN SysUserRole ur ON ur.roleId = rp.roleId " +
           "WHERE ur.userId = :userId")
    List<String> findPermissionCodesByUserId(Long userId);
}
