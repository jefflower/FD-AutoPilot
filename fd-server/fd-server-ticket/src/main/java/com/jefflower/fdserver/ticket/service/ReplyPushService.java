package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.ticket.client.FreshdeskApiClient;
import com.jefflower.fdserver.ticket.entity.FailedReplyPush;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketReply;
import com.jefflower.fdserver.ticket.repository.FailedReplyPushRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * 回复推送服务
 * 负责将审核通过的回复推送到 Freshdesk
 * 失败时记录到 failed_reply_push 表，由 ReplyPushRetryScheduler 定时重试
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ReplyPushService {

    private final FreshdeskApiClient apiClient;
    private final FailedReplyPushRepository failedPushRepository;

    /**
     * 推送回复到 Freshdesk
     * 失败时记录到重试表，不抛出异常
     */
    @Transactional
    public void pushReplyToFreshdesk(Ticket ticket, TicketReply reply) {
        log.info("Pushing reply to Freshdesk for ticket #{}", ticket.getExternalId());

        try {
            apiClient.pushReply(ticket.getExternalId(), reply.getTargetReply());
            log.info("Successfully pushed reply to Freshdesk for ticket #{}", ticket.getExternalId());

            // 推送成功后，将 Freshdesk 工单状态标记为 Pending（3），表示等待客户回复
            try {
                apiClient.updateTicketStatus(ticket.getExternalId(), 3);
                ticket.setFdStatus(3);
                log.info("Updated Freshdesk ticket #{} status to Pending", ticket.getExternalId());
            } catch (Exception statusEx) {
                log.warn("Reply pushed but failed to update Freshdesk status for ticket #{}: {}",
                        ticket.getExternalId(), statusEx.getMessage());
            }
        } catch (Exception e) {
            log.error("Failed to push reply to Freshdesk for ticket #{}, scheduling retry",
                    ticket.getExternalId(), e);

            FailedReplyPush failedPush = new FailedReplyPush();
            failedPush.setTicketId(ticket.getId());
            failedPush.setExternalId(ticket.getExternalId());
            failedPush.setReplyId(reply.getId());
            failedPush.setLastError(truncateError(e.getMessage()));
            failedPush.setNextRetryAt(LocalDateTime.now().plusMinutes(5));
            failedPushRepository.save(failedPush);

            log.info("Scheduled retry for ticket #{}, first retry at {}",
                    ticket.getExternalId(), failedPush.getNextRetryAt());
        }
    }

    private String truncateError(String error) {
        if (error == null) return "Unknown error";
        return error.length() > 1000 ? error.substring(0, 1000) : error;
    }
}
