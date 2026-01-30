package com.jefflower.fdserver.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "ticket_translation")
public class TicketTranslation {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne
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
