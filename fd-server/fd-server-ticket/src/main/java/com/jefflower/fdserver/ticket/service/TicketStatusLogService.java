package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketStatusLog;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.repository.TicketStatusLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 工单状态转换日志服务
 * <p>
 * 记录工单每次状态变更，供审计追踪和问题排查使用。
 * 使用 REQUIRES_NEW 传播级别，确保日志写入不受外部事务回滚影响。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TicketStatusLogService {

    private final TicketStatusLogRepository statusLogRepository;

    /**
     * 记录状态转换日志
     *
     * @param ticket      工单实体
     * @param from        转换前状态（可为 null，如首次创建）
     * @param to          转换后状态
     * @param triggeredBy 触发者标识（如 "n8n"、"user:admin"、"system:timeout"）
     * @param remark      备注信息
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void logTransition(Ticket ticket, TicketStatus from, TicketStatus to,
                              String triggeredBy, String remark) {
        try {
            TicketStatusLog logEntry = new TicketStatusLog();
            logEntry.setTicket(ticket);
            logEntry.setFromStatus(from);
            logEntry.setToStatus(to);
            logEntry.setTriggeredBy(triggeredBy);
            logEntry.setRemark(remark);
            statusLogRepository.save(logEntry);

            log.debug("[StatusLog] 工单#{} 状态转换: {} -> {}, 触发者={}, 备注={}",
                    ticket.getId(), from, to, triggeredBy, remark);
        } catch (Exception e) {
            // 日志记录失败不应影响主流程
            log.error("[StatusLog] 记录状态转换日志失败, ticketId={}, {} -> {}: {}",
                    ticket.getId(), from, to, e.getMessage());
        }
    }

    /**
     * 查询工单状态转换历史
     *
     * @param ticketId 工单 ID
     * @return 按时间正序排列的状态转换日志
     */
    public List<TicketStatusLog> getHistory(Long ticketId) {
        return statusLogRepository.findByTicketIdOrderByCreatedAtAsc(ticketId);
    }
}
