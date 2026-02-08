package com.jefflower.fdserver.scheduler;

import com.jefflower.fdserver.enums.TriggerType;
import com.jefflower.fdserver.service.FreshdeskSyncService;
import com.jefflower.fdserver.service.SyncConfigService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Freshdesk 同步定时任务
 * 作为 Webhook 的兜底机制，默认每 15 分钟执行一次
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SyncScheduler {

    private final FreshdeskSyncService freshdeskSyncService;
    private final SyncConfigService syncConfigService;

    /**
     * 定时同步任务
     * cron 表达式从配置读取，默认每 15 分钟执行一次
     */
    @Scheduled(cron = "${freshdesk.sync.cron:0 0/15 * * * ?}")
    public void scheduledSync() {
        if (!syncConfigService.isSyncEnabled()) {
            log.debug("Scheduled sync is disabled");
            return;
        }

        log.info("Scheduled sync triggered");
        FreshdeskSyncService.SyncResult result = freshdeskSyncService.syncTicketsWithLock(TriggerType.SCHEDULED);

        if (result.isSuccess()) {
            log.info("Scheduled sync completed: synced={}, updated={}, skipped={}",
                    result.getSyncedCount(), result.getUpdatedCount(), result.getSkippedCount());
        } else {
            log.warn("Scheduled sync skipped or failed: {}", result.getMessage());
        }
    }
}
