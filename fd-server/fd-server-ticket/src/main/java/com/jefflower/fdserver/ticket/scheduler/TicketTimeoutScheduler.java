package com.jefflower.fdserver.ticket.scheduler;

import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import com.jefflower.fdserver.ticket.service.TicketStatusLogService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 工单状态超时自动转换调度器
 * <p>
 * 定时扫描处于中间状态的工单，根据超时配置自动回退或推进状态，
 * 防止工单因 Agent 执行卡住或审核人未处理而长期积压。
 * <p>
 * 超时场景：
 * <ul>
 *   <li>PROCESSING/TRANSLATING/PENDING_REPLY/REPLYING 超时（默认 4 小时）→ 回退到 PENDING_TRANS</li>
 *   <li>PENDING_AUDIT 超时（默认 48 小时）→ 自动 APPROVED，防止工单堆积</li>
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TicketTimeoutScheduler {

    private final TicketRepository ticketRepository;
    private final TicketStatusLogService statusLogService;

    /**
     * PROCESSING/TRANSLATING/PENDING_REPLY/REPLYING 状态超时小时数
     */
    @Value("${ticket.timeout.processing-hours:4}")
    private int processingTimeoutHours;

    /**
     * PENDING_AUDIT 状态超时小时数（审核人未处理）
     */
    @Value("${ticket.timeout.pending-audit-hours:48}")
    private int pendingAuditTimeoutHours;

    /**
     * 每小时执行一次，检查并处理超时工单
     */
    @Scheduled(cron = "0 0 * * * ?")
    @Transactional
    public void handleTimeoutTickets() {
        log.debug("[TimeoutScheduler] 开始检查超时工单");

        int processingCount = handleStatusTimeout(TicketStatus.PROCESSING);
        int translatingCount = handleStatusTimeout(TicketStatus.TRANSLATING);
        int pendingReplyCount = handleStatusTimeout(TicketStatus.PENDING_REPLY);
        int replyingCount = handleStatusTimeout(TicketStatus.REPLYING);
        int pendingAuditCount = handlePendingAuditTimeout();

        int totalReset = processingCount + translatingCount + pendingReplyCount + replyingCount;
        if (totalReset > 0 || pendingAuditCount > 0) {
            log.info("[TimeoutScheduler] 超时处理完成: 处理中回退={}个, PENDING_AUDIT自动审核={}个",
                    totalReset, pendingAuditCount);
        }
    }

    /**
     * 处理指定状态的超时回退：
     * Agent 执行卡住超过阈值，回退到 PENDING_TRANS 允许 n8n 重新拾取处理
     */
    private int handleStatusTimeout(TicketStatus status) {
        LocalDateTime cutoff = LocalDateTime.now().minusHours(processingTimeoutHours);
        List<Ticket> timeoutTickets = ticketRepository.findByStatusAndUpdatedAtBefore(status, cutoff);

        for (Ticket ticket : timeoutTickets) {
            try {
                TicketStatus fromStatus = ticket.getStatus();
                ticket.setStatus(TicketStatus.PENDING_TRANS);
                ticket.setUpdatedAt(LocalDateTime.now());
                ticketRepository.save(ticket);

                statusLogService.logTransition(ticket, fromStatus, TicketStatus.PENDING_TRANS,
                        "system:timeout",
                        String.format("%s 状态超时 %d 小时，自动回退至 PENDING_TRANS", status, processingTimeoutHours));

                log.info("[TimeoutScheduler] 工单#{} {} 超时回退至 PENDING_TRANS",
                        ticket.getId(), status);
            } catch (Exception e) {
                log.error("[TimeoutScheduler] 工单#{} {} 超时回退失败: {}",
                        ticket.getId(), status, e.getMessage());
            }
        }

        return timeoutTickets.size();
    }

    /**
     * 处理 PENDING_AUDIT 状态超时：
     * 审核人超过阈值未处理，自动设为 APPROVED 防止工单堆积
     */
    private int handlePendingAuditTimeout() {
        LocalDateTime cutoff = LocalDateTime.now().minusHours(pendingAuditTimeoutHours);
        List<Ticket> timeoutTickets = ticketRepository.findByStatusAndUpdatedAtBefore(
                TicketStatus.PENDING_AUDIT, cutoff);

        for (Ticket ticket : timeoutTickets) {
            try {
                TicketStatus fromStatus = ticket.getStatus();
                ticket.setStatus(TicketStatus.APPROVED);
                ticket.setUpdatedAt(LocalDateTime.now());
                ticketRepository.save(ticket);

                statusLogService.logTransition(ticket, fromStatus, TicketStatus.APPROVED,
                        "system:timeout",
                        String.format("PENDING_AUDIT 状态超时 %d 小时，自动审核通过", pendingAuditTimeoutHours));

                log.info("[TimeoutScheduler] 工单#{} PENDING_AUDIT 超时自动审核通过, updatedAt={}",
                        ticket.getId(), ticket.getUpdatedAt());
            } catch (Exception e) {
                log.error("[TimeoutScheduler] 工单#{} PENDING_AUDIT 超时自动审核失败: {}",
                        ticket.getId(), e.getMessage());
            }
        }

        return timeoutTickets.size();
    }
}
