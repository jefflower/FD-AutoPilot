package com.jefflower.fdserver.scheduler;

import com.jefflower.fdserver.enums.TriggerType;
import com.jefflower.fdserver.service.FreshdeskService;
import com.jefflower.fdserver.service.SyncConfigService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Freshdesk 同步定时任务
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SyncScheduler {

    private final FreshdeskService freshdeskService;
    private final SyncConfigService syncConfigService;

    /**
     * 定时同步任务
     * cron 表达式从配置读取，默认每5分钟执行一次
     */
    @Scheduled(cron = "${freshdesk.sync.cron:0 0/5 * * * ?}")
    public void scheduledSync() {
        // 检查是否启用自动同步
        if (!syncConfigService.isSyncEnabled()) {
            log.debug("Scheduled sync is disabled");
            return;
        }

        log.info("Scheduled sync triggered");
        FreshdeskService.SyncResult result = freshdeskService.syncTicketsWithLock(TriggerType.SCHEDULED);

        if (result.isSuccess()) {
            log.info("Scheduled sync completed: synced={}, updated={}",
                    result.getSyncedCount(), result.getUpdatedCount());
        } else {
            log.warn("Scheduled sync skipped or failed: {}", result.getMessage());
        }
    }
}
