package com.jefflower.fdserver.workflow.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "wf_definition")
@Getter @Setter @NoArgsConstructor
public class WorkflowDefinition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** BPMN process id（唯一标识） */
    @Column(unique = true, nullable = false, length = 128)
    private String processKey;

    @Column(nullable = false)
    private String name;

    @Column(length = 500)
    private String description;

    /** 业务类型（如 "ticket"），用于按业务场景筛选 */
    @Column(nullable = false, length = 64)
    private String businessType;

    /** Flowable 部署后回填 */
    @Column(length = 128)
    private String deploymentId;

    /** Flowable 部署后回填 */
    @Column(length = 128)
    private String processDefinitionId;

    /** BPMN XML 原文 */
    @Lob
    @Column(columnDefinition = "CLOB")
    private String bpmnXml;

    private boolean enabled = true;

    private boolean builtIn = false;

    private int version = 1;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
