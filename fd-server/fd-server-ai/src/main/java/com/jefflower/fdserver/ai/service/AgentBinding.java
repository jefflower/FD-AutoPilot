package com.jefflower.fdserver.ai.service;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_agent_binding")
@Getter @Setter @NoArgsConstructor
public class AgentBinding {

    @Id
    @Column(length = 64)
    private String capability;

    @Column(nullable = false, length = 64)
    private String agentCode;

    private LocalDateTime updatedAt;

    @PrePersist
    @PreUpdate
    protected void onSave() {
        updatedAt = LocalDateTime.now();
    }
}
