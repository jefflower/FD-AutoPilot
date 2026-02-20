package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.AuditToken;
import com.jefflower.fdserver.ticket.enums.AuditTokenStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface AuditTokenRepository extends JpaRepository<AuditToken, Long> {

    Optional<AuditToken> findByToken(String token);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM AuditToken t WHERE t.token = :token")
    Optional<AuditToken> findByTokenForUpdate(@Param("token") String token);

    @Modifying
    @Query("UPDATE AuditToken t SET t.status = :newStatus WHERE t.ticketId = :ticketId AND t.status = :oldStatus")
    int updateStatusByTicketIdAndStatus(@Param("ticketId") Long ticketId,
                                        @Param("oldStatus") AuditTokenStatus oldStatus,
                                        @Param("newStatus") AuditTokenStatus newStatus);

    Optional<AuditToken> findFirstByTicketIdAndStatusOrderByCreatedAtDesc(Long ticketId, AuditTokenStatus status);
}
