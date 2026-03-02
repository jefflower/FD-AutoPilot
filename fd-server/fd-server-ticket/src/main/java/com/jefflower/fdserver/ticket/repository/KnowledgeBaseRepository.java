package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.KnowledgeBase;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface KnowledgeBaseRepository extends JpaRepository<KnowledgeBase, Long> {

    Optional<KnowledgeBase> findByNotebookId(String notebookId);

    List<KnowledgeBase> findByGroupIdOrderByCreatedAtDesc(Long groupId);
}
