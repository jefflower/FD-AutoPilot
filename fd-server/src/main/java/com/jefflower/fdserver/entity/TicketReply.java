package com.jefflower.fdserver.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "ticket_reply")
public class TicketReply {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "ticket_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Ticket ticket;

    @Column(name = "reply_lang", length = 16)
    private String replyLang;

    @Lob
    @Column(name = "zh_reply")
    private String zhReply;

    @Lob
    @Column(name = "target_reply")
    private String targetReply;

    @Column(name = "is_selected")
    private Boolean isSelected = false;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
