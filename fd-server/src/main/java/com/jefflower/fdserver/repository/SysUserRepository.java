package com.jefflower.fdserver.repository;

import com.jefflower.fdserver.entity.SysUser;
import com.jefflower.fdserver.enums.UserStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface SysUserRepository extends JpaRepository<SysUser, Long> {
    Optional<SysUser> findByUsername(String username);

    List<SysUser> findByStatus(UserStatus status);

    boolean existsByUsername(String username);
}
