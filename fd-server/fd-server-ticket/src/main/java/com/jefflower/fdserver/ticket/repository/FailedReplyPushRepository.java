package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.FailedReplyPush;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface FailedReplyPushRepository extends JpaRepository<FailedReplyPush, Long> {

    List<FailedReplyPush> findByStatusAndNextRetryAtBefore(String status, LocalDateTime now);

    Optional<FailedReplyPush> findByTicketIdAndStatus(Long ticketId, String status);
}
