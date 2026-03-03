package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface TicketAuditRepository extends JpaRepository<TicketAudit, Long> {
    List<TicketAudit> findByTicket(Ticket ticket);

    /**
     * 获取工单最新的审核记录（用于幂等性检查时返回已有记录）
     */
    Optional<TicketAudit> findTopByTicketOrderByCreatedAtDesc(Ticket ticket);

    /**
     * 获取工单的审核历史（按时间倒序）
     */
    List<TicketAudit> findByTicketOrderByCreatedAtDesc(Ticket ticket);
}
