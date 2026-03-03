package com.jefflower.fdserver.ticket.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.jefflower.fdserver.ticket.enums.KnowledgeSourceType;
import com.jefflower.fdserver.ticket.enums.KnowledgeSyncStatus;
import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "knowledge_source", indexes = {
        @Index(name = "idx_ks_base_id", columnList = "knowledge_base_id"),
        @Index(name = "idx_ks_sync_status", columnList = "sync_status")
})
public class KnowledgeSource {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "knowledge_base_id", nullable = false)
    private KnowledgeBase knowledgeBase;

    @Column(name = "knowledge_base_id", insertable = false, updatable = false)
    private Long knowledgeBaseId;

    @Column(nullable = false, length = 200)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(name = "source_type", nullable = false, length = 20)
    private KnowledgeSourceType sourceType;

    @Column(columnDefinition = "TEXT")
    private String content;

    @Column(name = "file_path", length = 500)
    private String filePath;

    @Column(name = "original_file_name", length = 300)
    private String originalFileName;

    @Column(length = 1000)
    private String url;

    @Column(name = "file_size")
    private Long fileSize;

    @Enumerated(EnumType.STRING)
    @Column(name = "sync_status", length = 20)
    private KnowledgeSyncStatus syncStatus = KnowledgeSyncStatus.NOT_SYNCED;

    @Column(name = "notebook_source_id", length = 100)
    private String notebookSourceId;

    @Column(name = "synced_at")
    private LocalDateTime syncedAt;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
