package com.jefflower.fdserver.repository;

import com.jefflower.fdserver.entity.Ticket;
import com.jefflower.fdserver.entity.TicketAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface TicketAuditRepository extends JpaRepository<TicketAudit, Long> {
    List<TicketAudit> findByTicket(Ticket ticket);

    /**
     * 获取工单最新的审核记录（用于幂等性检查时返回已有记录）
     */
    Optional<TicketAudit> findTopByTicketOrderByCreatedAtDesc(Ticket ticket);
}
