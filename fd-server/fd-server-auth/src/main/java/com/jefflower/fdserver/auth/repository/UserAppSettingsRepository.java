package com.jefflower.fdserver.auth.repository;

import com.jefflower.fdserver.auth.entity.UserAppSettings;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface UserAppSettingsRepository extends JpaRepository<UserAppSettings, Long> {
    Optional<UserAppSettings> findByUserIdAndAppCode(Long userId, String appCode);

    List<UserAppSettings> findByUserId(Long userId);

    void deleteByUserIdAndAppCode(Long userId, String appCode);
}
