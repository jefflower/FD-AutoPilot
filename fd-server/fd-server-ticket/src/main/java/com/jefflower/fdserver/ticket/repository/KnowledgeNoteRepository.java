package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.KnowledgeNote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface KnowledgeNoteRepository extends JpaRepository<KnowledgeNote, Long> {
    List<KnowledgeNote> findAllByOrderBySortOrderAscIdAsc();
}
