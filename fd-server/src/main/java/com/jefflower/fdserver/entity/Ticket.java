package com.jefflower.fdserver.entity;

import com.jefflower.fdserver.enums.TicketStatus;
import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "ticket")
public class Ticket {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "external_id", unique = true, nullable = false, length = 64)
    private String externalId;

    @Lob
    private String subject;

    @Lob
    private String content;

    @Column(name = "source_lang", length = 16)
    private String sourceLang;

    @Enumerated(EnumType.STRING)
    @Column(length = 32)
    private TicketStatus status = TicketStatus.PENDING_TRANS;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "is_valid")
    private Boolean isValid = false;

    @OneToMany(mappedBy = "ticket", fetch = FetchType.EAGER)
    @OrderBy("id DESC")
    private java.util.List<TicketTranslation> translations;

    @OneToMany(mappedBy = "ticket", fetch = FetchType.EAGER)
    @OrderBy("createdAt DESC")
    private java.util.List<TicketReply> replies;

    @com.fasterxml.jackson.annotation.JsonProperty("translation")
    public TicketTranslation getTranslation() {
        if (translations == null || translations.isEmpty())
            return null;
        return translations.stream()
                .sorted((a, b) -> b.getId().compareTo(a.getId()))
                .findFirst()
                .orElse(null);
    }

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
