package com.jefflower.fdserver.service;

import com.jefflower.fdserver.entity.SyncConfig;
import com.jefflower.fdserver.entity.SyncLog;
import com.jefflower.fdserver.enums.SyncStatus;
import com.jefflower.fdserver.repository.SyncConfigRepository;
import com.jefflower.fdserver.repository.SyncLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.PostConstruct;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 同步配置服务
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SyncConfigService {

    private final SyncConfigRepository configRepository;
    private final SyncLogRepository logRepository;

    // 同步互斥锁
    private final AtomicBoolean isSyncing = new AtomicBoolean(false);

    private static final DateTimeFormatter DT_FORMAT = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    /**
     * 初始化默认配置
     */
    @PostConstruct
    @Transactional
    public void initDefaultConfig() {
        // 默认 cron: 每5分钟执行一次
        saveConfigIfNotExists(SyncConfig.KEY_SYNC_CRON, "0 0/5 * * * ?", "定时同步 cron 表达式");
        // 默认启用
        saveConfigIfNotExists(SyncConfig.KEY_SYNC_ENABLED, "true", "是否启用自动同步");
        // 上次同步时间（初始为空）
        saveConfigIfNotExists(SyncConfig.KEY_LAST_SYNC_TIME, "", "上次同步时间");
    }

    private void saveConfigIfNotExists(String key, String value, String description) {
        if (configRepository.findByConfigKey(key).isEmpty()) {
            SyncConfig config = new SyncConfig();
            config.setConfigKey(key);
            config.setConfigValue(value);
            config.setDescription(description);
            configRepository.save(config);
            log.info("Initialized config: {} = {}", key, value);
        }
    }

    // ========== 配置管理 ==========

    public String getConfigValue(String key) {
        return configRepository.findByConfigKey(key)
                .map(SyncConfig::getConfigValue)
                .orElse(null);
    }

    @Transactional
    public void updateConfig(String key, String value) {
        SyncConfig config = configRepository.findByConfigKey(key)
                .orElseThrow(() -> new RuntimeException("配置不存在: " + key));
        config.setConfigValue(value);
        configRepository.save(config);
        log.info("Updated config: {} = {}", key, value);
    }

    public String getCronExpression() {
        return getConfigValue(SyncConfig.KEY_SYNC_CRON);
    }

    public boolean isSyncEnabled() {
        return "true".equalsIgnoreCase(getConfigValue(SyncConfig.KEY_SYNC_ENABLED));
    }

    public LocalDateTime getLastSyncTime() {
        String value = getConfigValue(SyncConfig.KEY_LAST_SYNC_TIME);
        if (value == null || value.isEmpty()) {
            return null;
        }
        return LocalDateTime.parse(value, DT_FORMAT);
    }

    @Transactional
    public void updateLastSyncTime(LocalDateTime time) {
        updateConfig(SyncConfig.KEY_LAST_SYNC_TIME, time.format(DT_FORMAT));
    }

    // ========== 同步锁管理 ==========

    public boolean tryAcquireSyncLock() {
        return isSyncing.compareAndSet(false, true);
    }

    public void releaseSyncLock() {
        isSyncing.set(false);
    }

    public boolean isSyncing() {
        return isSyncing.get();
    }

    // ========== 日志管理 ==========

    public Page<SyncLog> getSyncLogs(Pageable pageable) {
        return logRepository.findAllByOrderByStartTimeDesc(pageable);
    }

    @Transactional
    public SyncLog createSyncLog(com.jefflower.fdserver.enums.TriggerType triggerType) {
        SyncLog log = new SyncLog();
        log.setStartTime(LocalDateTime.now());
        log.setTriggerType(triggerType);
        log.setStatus(SyncStatus.RUNNING);
        return logRepository.save(log);
    }

    @Transactional
    public void completeSyncLog(SyncLog syncLog, int synced, int updated) {
        syncLog.setEndTime(LocalDateTime.now());
        syncLog.setTicketsSynced(synced);
        syncLog.setTicketsUpdated(updated);
        syncLog.setStatus(SyncStatus.SUCCESS);
        logRepository.save(syncLog);
    }

    @Transactional
    public void failSyncLog(SyncLog syncLog, String errorMessage) {
        syncLog.setEndTime(LocalDateTime.now());
        syncLog.setStatus(SyncStatus.FAILED);
        syncLog.setErrorMessage(errorMessage);
        logRepository.save(syncLog);
    }
}
