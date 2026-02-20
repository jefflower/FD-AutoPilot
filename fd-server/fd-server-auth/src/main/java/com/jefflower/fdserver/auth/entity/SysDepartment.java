package com.jefflower.fdserver.auth.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "sys_department", indexes = {
        @Index(name = "idx_dept_external", columnList = "external_id, platform"),
        @Index(name = "idx_dept_parent", columnList = "parent_id")
})
public class SysDepartment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(name = "parent_id")
    private Long parentId;

    @Column(name = "external_id", length = 128)
    private String externalId;

    @Column(length = 32)
    private String platform;

    @Column(name = "sort_order")
    private Integer sortOrder = 0;

    @Column(length = 512)
    private String path;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();
}
