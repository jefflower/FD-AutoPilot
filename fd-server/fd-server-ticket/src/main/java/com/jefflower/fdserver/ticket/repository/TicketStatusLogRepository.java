package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.TicketStatusLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TicketStatusLogRepository extends JpaRepository<TicketStatusLog, Long> {

    /**
     * 查询指定工单的状态转换历史，按时间正序排列
     */
    List<TicketStatusLog> findByTicketIdOrderByCreatedAtAsc(Long ticketId);
}
