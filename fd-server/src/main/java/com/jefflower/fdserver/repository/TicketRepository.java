package com.jefflower.fdserver.repository;

import com.jefflower.fdserver.entity.Ticket;
import com.jefflower.fdserver.enums.TicketStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.LocalDateTime;
import java.util.Optional;

public interface TicketRepository extends JpaRepository<Ticket, Long> {
        Optional<Ticket> findByExternalId(String externalId);

        @Query("SELECT t FROM Ticket t WHERE " +
                        "(:status IS NULL OR t.status = :status) AND " +
                        "(:externalId IS NULL OR t.externalId = :externalId) AND " +
                        "(:subject IS NULL OR t.subject LIKE %:subject%) AND " +
                        "(:isValid IS NULL OR t.isValid = :isValid) AND " +
                        "(:createdAfter IS NULL OR t.createdAt >= :createdAfter) AND " +
                        "(:createdBefore IS NULL OR t.createdAt <= :createdBefore)")
        Page<Ticket> findByFilters(
                        @Param("status") TicketStatus status,
                        @Param("externalId") String externalId,
                        @Param("subject") String subject,
                        @Param("isValid") Boolean isValid,
                        @Param("createdAfter") LocalDateTime createdAfter,
                        @Param("createdBefore") LocalDateTime createdBefore,
                        Pageable pageable);
}
