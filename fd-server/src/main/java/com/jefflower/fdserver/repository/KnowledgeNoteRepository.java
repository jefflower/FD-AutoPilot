package com.jefflower.fdserver.repository;

import com.jefflower.fdserver.entity.KnowledgeNote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface KnowledgeNoteRepository extends JpaRepository<KnowledgeNote, Long> {
    List<KnowledgeNote> findAllByOrderBySortOrderAscIdAsc();
}
