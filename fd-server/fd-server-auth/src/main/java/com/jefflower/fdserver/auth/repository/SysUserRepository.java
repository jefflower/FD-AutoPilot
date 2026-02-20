package com.jefflower.fdserver.auth.repository;

import com.jefflower.fdserver.auth.entity.SysUser;
import com.jefflower.fdserver.auth.enums.UserStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface SysUserRepository extends JpaRepository<SysUser, Long> {
    Optional<SysUser> findByUsername(String username);

    List<SysUser> findByStatus(UserStatus status);

    Page<SysUser> findByStatus(UserStatus status, Pageable pageable);

    Page<SysUser> findByUsernameContainingIgnoreCase(String username, Pageable pageable);

    Page<SysUser> findByStatusAndUsernameContainingIgnoreCase(UserStatus status, String username, Pageable pageable);

    boolean existsByUsername(String username);

    Optional<SysUser> findByDingtalkUserId(String dingtalkUserId);

    Optional<SysUser> findByWecomUserId(String wecomUserId);

    List<SysUser> findByDepartmentId(Long departmentId);
}
