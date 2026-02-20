package com.jefflower.fdserver.ticket.scheduler;

import com.jefflower.fdserver.ticket.client.FreshdeskApiClient;
import com.jefflower.fdserver.ticket.entity.FailedReplyPush;
import com.jefflower.fdserver.ticket.entity.TicketReply;
import com.jefflower.fdserver.ticket.repository.FailedReplyPushRepository;
import com.jefflower.fdserver.ticket.repository.TicketReplyRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 失败回复推送重试定时器
 * 每 2 分钟扫描 failed_reply_push 表，重试到期的失败推送
 * 指数退避：5min → 10min → 20min → 40min → 80min
 * 超过 maxRetries 次标记为 EXHAUSTED
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ReplyPushRetryScheduler {

    private final FailedReplyPushRepository failedPushRepository;
    private final TicketReplyRepository replyRepository;
    private final FreshdeskApiClient apiClient;

    @Scheduled(cron = "0 0/2 * * * ?")
    public void retryFailedPushes() {
        List<FailedReplyPush> pendingRetries = failedPushRepository
                .findByStatusAndNextRetryAtBefore("PENDING", LocalDateTime.now());

        if (pendingRetries.isEmpty()) {
            return;
        }

        log.info("Found {} failed reply pushes to retry", pendingRetries.size());

        for (FailedReplyPush failedPush : pendingRetries) {
            retryOnePush(failedPush);
        }
    }

    private void retryOnePush(FailedReplyPush failedPush) {
        try {
            TicketReply reply = replyRepository.findById(failedPush.getReplyId()).orElse(null);
            if (reply == null) {
                log.error("Reply #{} not found for failed push, marking as EXHAUSTED",
                        failedPush.getReplyId());
                failedPush.setStatus("EXHAUSTED");
                failedPush.setLastError("Reply record not found");
                failedPushRepository.save(failedPush);
                return;
            }

            apiClient.pushReply(failedPush.getExternalId(), reply.getTargetReply());

            failedPush.setStatus("SUCCESS");
            failedPushRepository.save(failedPush);
            log.info("Retry succeeded for ticket #{} (attempt #{})",
                    failedPush.getExternalId(), failedPush.getRetryCount() + 1);

        } catch (Exception e) {
            failedPush.setRetryCount(failedPush.getRetryCount() + 1);
            failedPush.setLastError(e.getMessage() != null
                    ? (e.getMessage().length() > 1000 ? e.getMessage().substring(0, 1000) : e.getMessage())
                    : "Unknown error");

            if (failedPush.getRetryCount() >= failedPush.getMaxRetries()) {
                failedPush.setStatus("EXHAUSTED");
                log.error("Retry exhausted for ticket #{} after {} attempts",
                        failedPush.getExternalId(), failedPush.getRetryCount());
            } else {
                // 指数退避: 5min, 10min, 20min, 40min, 80min
                long delayMinutes = 5L * (long) Math.pow(2, failedPush.getRetryCount() - 1);
                failedPush.setNextRetryAt(LocalDateTime.now().plusMinutes(delayMinutes));
                log.warn("Retry #{} failed for ticket #{}, next retry in {}min",
                        failedPush.getRetryCount(), failedPush.getExternalId(), delayMinutes);
            }

            failedPushRepository.save(failedPush);
        }
    }
}
