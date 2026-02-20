package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.ticket.entity.SyncConfig;
import com.jefflower.fdserver.ticket.entity.SyncLog;
import com.jefflower.fdserver.ticket.enums.SyncStatus;
import com.jefflower.fdserver.ticket.enums.TriggerType;
import com.jefflower.fdserver.ticket.repository.SyncConfigRepository;
import com.jefflower.fdserver.ticket.repository.SyncLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.PostConstruct;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

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

    // 锁获取时间，用于 TTL 过期检测
    private final AtomicReference<LocalDateTime> lockAcquiredAt = new AtomicReference<>(null);

    // 锁最大持有时间：10 分钟，超过则视为死锁
    private static final Duration LOCK_TTL = Duration.ofMinutes(10);

    private static final DateTimeFormatter DT_FORMAT = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    /**
     * 初始化默认配置
     */
    @PostConstruct
    @Transactional
    public void initDefaultConfig() {
        // 默认 cron: 每1分钟执行一次
        saveConfigIfNotExists(SyncConfig.KEY_SYNC_CRON, "0 0/1 * * * ?", "定时同步 cron 表达式");
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

    /**
     * 尝试获取同步锁。
     * <p>
     * 如果锁空闲，直接获取并记录时间戳。
     * 如果锁已被持有但超过 TTL（10 分钟），则强制释放旧锁并重新获取，
     * 防止因应用崩溃或线程异常退出导致的永久死锁。
     *
     * @return true 如果成功获取锁
     */
    public boolean tryAcquireSyncLock() {
        // 快速路径：锁空闲，直接获取
        if (isSyncing.compareAndSet(false, true)) {
            lockAcquiredAt.set(LocalDateTime.now());
            return true;
        }

        // 锁已被持有，检查是否超过 TTL
        LocalDateTime acquiredTime = lockAcquiredAt.get();
        if (acquiredTime != null) {
            Duration held = Duration.between(acquiredTime, LocalDateTime.now());
            if (held.compareTo(LOCK_TTL) > 0) {
                // 锁已超时，强制释放并重新获取
                // 使用 CAS 确保只有一个线程能完成"释放旧锁 + 获取新锁"的操作
                if (lockAcquiredAt.compareAndSet(acquiredTime, null)) {
                    isSyncing.set(false);
                    log.warn("同步锁已超时（持有 {} 分钟，TTL {} 分钟），强制释放旧锁",
                            held.toMinutes(), LOCK_TTL.toMinutes());
                    // 再次尝试获取
                    if (isSyncing.compareAndSet(false, true)) {
                        lockAcquiredAt.set(LocalDateTime.now());
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * 释放同步锁，同时清除锁获取时间戳。
     */
    public void releaseSyncLock() {
        lockAcquiredAt.set(null);
        isSyncing.set(false);
    }

    public boolean isSyncing() {
        return isSyncing.get();
    }

    /**
     * 定期检查并自动释放过期的同步锁。
     * <p>
     * 每 60 秒执行一次。如果发现锁持有时间超过 TTL，自动释放，
     * 作为 tryAcquireSyncLock() 中 TTL 检查的补充防线。
     */
    @Scheduled(fixedRate = 60000)
    public void checkStaleLock() {
        if (!isSyncing.get()) {
            return;
        }

        LocalDateTime acquiredTime = lockAcquiredAt.get();
        if (acquiredTime == null) {
            // 锁被持有但没有时间戳（异常状态），强制释放
            log.warn("检测到同步锁处于异常状态（已锁定但无时间戳），强制释放");
            isSyncing.set(false);
            return;
        }

        Duration held = Duration.between(acquiredTime, LocalDateTime.now());
        if (held.compareTo(LOCK_TTL) > 0) {
            // 使用 CAS 确保只释放一次
            if (lockAcquiredAt.compareAndSet(acquiredTime, null)) {
                isSyncing.set(false);
                log.warn("定时检查发现同步锁已过期（持有 {} 分钟，TTL {} 分钟），自动释放",
                        held.toMinutes(), LOCK_TTL.toMinutes());
            }
        }
    }

    // ========== 日志管理 ==========

    public Page<SyncLog> getSyncLogs(Pageable pageable) {
        return logRepository.findAllByOrderByStartTimeDesc(pageable);
    }

    @Transactional
    public SyncLog createSyncLog(TriggerType triggerType) {
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
