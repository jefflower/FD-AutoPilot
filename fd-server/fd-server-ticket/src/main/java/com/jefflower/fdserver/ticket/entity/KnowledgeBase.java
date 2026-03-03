package com.jefflower.fdserver.ticket.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.jefflower.fdserver.ticket.enums.KnowledgeVisibility;
import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "knowledge_base")
public class KnowledgeBase {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "notebook_id", length = 100)
    private String notebookId;

    @Column(length = 20)
    private String color = "amber";

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id")
    private KnowledgeGroup group;

    @Column(name = "group_id", insertable = false, updatable = false)
    private Long groupId;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private KnowledgeVisibility visibility = KnowledgeVisibility.PUBLIC;

    @Column(name = "created_by")
    private Long createdBy;

    @Transient
    private Long sourceCount;

    @Transient
    private Long syncedCount;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
