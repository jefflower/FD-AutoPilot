package com.jefflower.fdserver.repository;

import com.jefflower.fdserver.entity.Ticket;
import com.jefflower.fdserver.entity.TicketTranslation;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface TicketTranslationRepository extends JpaRepository<TicketTranslation, Long> {
    List<TicketTranslation> findByTicket(Ticket ticket);

    Optional<TicketTranslation> findByTicketAndTargetLang(Ticket ticket, String targetLang);
}
