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
@Table(name = "ticket_reply", indexes = {
        @Index(name = "idx_reply_ticket_id", columnList = "ticket_id")
})
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

    @Column(name = "zh_reply", columnDefinition = "TEXT")
    private String zhReply;

    @Column(name = "target_reply", columnDefinition = "TEXT")
    private String targetReply;

    @Column(name = "is_selected")
    private Boolean isSelected = false;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
