package com.jefflower.fdserver.auth.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "sys_module", indexes = {
        @Index(name = "idx_sys_module_code", columnList = "code", unique = true)
})
public class SysModule {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 32)
    private String code;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(length = 256)
    private String description;

    @Column(length = 64)
    private String icon;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    @Column(nullable = false)
    private Boolean enabled = true;

    @Column(name = "route_path", length = 128)
    private String routePath;

    @Column(name = "built_in", nullable = false)
    private Boolean builtIn = false;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    public SysModule(String code, String name, String description, String icon,
                     String routePath, int sortOrder, boolean builtIn) {
        this.code = code;
        this.name = name;
        this.description = description;
        this.icon = icon;
        this.routePath = routePath;
        this.sortOrder = sortOrder;
        this.builtIn = builtIn;
        this.enabled = true;
        this.createdAt = LocalDateTime.now();
    }
}
