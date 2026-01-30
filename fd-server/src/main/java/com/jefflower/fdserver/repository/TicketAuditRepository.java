package com.jefflower.fdserver.repository;

import com.jefflower.fdserver.entity.Ticket;
import com.jefflower.fdserver.entity.TicketAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface TicketAuditRepository extends JpaRepository<TicketAudit, Long> {
    List<TicketAudit> findByTicket(Ticket ticket);
}
