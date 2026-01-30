package com.jefflower.fdserver.repository;

import com.jefflower.fdserver.entity.Ticket;
import com.jefflower.fdserver.entity.TicketReply;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface TicketReplyRepository extends JpaRepository<TicketReply, Long> {
    List<TicketReply> findByTicket(Ticket ticket);
}
