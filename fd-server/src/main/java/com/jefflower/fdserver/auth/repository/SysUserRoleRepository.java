package com.jefflower.fdserver.auth.repository;

import com.jefflower.fdserver.auth.entity.SysUserRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;

public interface SysUserRoleRepository extends JpaRepository<SysUserRole, Long> {
    List<SysUserRole> findByUserId(Long userId);
    List<SysUserRole> findByRoleId(Long roleId);
    void deleteByUserId(Long userId);
    void deleteByUserIdAndRoleId(Long userId, Long roleId);
    boolean existsByUserIdAndRoleId(Long userId, Long roleId);

    @Query("SELECT ur.userId FROM SysUserRole ur WHERE ur.roleId = :roleId")
    List<Long> findUserIdsByRoleId(Long roleId);
}
