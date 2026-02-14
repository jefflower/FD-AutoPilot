package com.jefflower.fdserver.ticket.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import java.time.LocalDateTime;

@Data
@EqualsAndHashCode(exclude = {"ticket"})
@ToString(exclude = {"ticket"})
@Entity
@Table(name = "ticket_translation", indexes = {
        @Index(name = "idx_translation_ticket_id", columnList = "ticket_id")
})
public class TicketTranslation {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "ticket_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Ticket ticket;

    @Column(name = "target_lang", length = 16)
    private String targetLang;

    @Lob
    @Column(name = "translated_title")
    private String translatedTitle;

    @Lob
    @Column(name = "translated_content")
    private String translatedContent;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
