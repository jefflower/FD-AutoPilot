package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.KnowledgeSource;
import com.jefflower.fdserver.ticket.enums.KnowledgeSyncStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface KnowledgeSourceRepository extends JpaRepository<KnowledgeSource, Long> {

    List<KnowledgeSource> findByKnowledgeBaseIdOrderByCreatedAtDesc(Long baseId);

    List<KnowledgeSource> findByKnowledgeBaseIdAndSyncStatus(Long baseId, KnowledgeSyncStatus status);

    Optional<KnowledgeSource> findByKnowledgeBaseIdAndNotebookSourceId(Long baseId, String notebookSourceId);

    long countByKnowledgeBaseId(Long baseId);

    long countByKnowledgeBaseIdAndSyncStatus(Long baseId, KnowledgeSyncStatus status);

    void deleteAllByKnowledgeBaseId(Long baseId);
}
