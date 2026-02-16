package com.jefflower.fdserver.auth.service;

import com.jefflower.fdserver.auth.entity.UserAppSettings;
import com.jefflower.fdserver.auth.repository.UserAppSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class UserAppSettingsService {

    private final UserAppSettingsRepository userAppSettingsRepository;

    public Optional<String> getSettings(Long userId, String appCode) {
        return userAppSettingsRepository.findByUserIdAndAppCode(userId, appCode)
                .map(UserAppSettings::getSettingsJson);
    }

    @Transactional
    public String saveSettings(Long userId, String appCode, String settingsJson) {
        Optional<UserAppSettings> existing = userAppSettingsRepository.findByUserIdAndAppCode(userId, appCode);
        UserAppSettings settings;
        if (existing.isPresent()) {
            settings = existing.get();
            settings.setSettingsJson(settingsJson);
            settings.setUpdatedAt(LocalDateTime.now());
        } else {
            settings = new UserAppSettings();
            settings.setUserId(userId);
            settings.setAppCode(appCode);
            settings.setSettingsJson(settingsJson);
        }
        userAppSettingsRepository.save(settings);
        return settings.getSettingsJson();
    }

    @Transactional
    public void deleteSettings(Long userId, String appCode) {
        userAppSettingsRepository.deleteByUserIdAndAppCode(userId, appCode);
    }

    public List<UserAppSettings> getAllSettings(Long userId) {
        return userAppSettingsRepository.findByUserId(userId);
    }
}
