package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.dto.TicketListDTO;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface TicketRepository extends JpaRepository<Ticket, Long> {

        /**
         * 查询指定状态且 updatedAt 早于截止时间的工单（用于超时检测）
         */
        List<Ticket> findByStatusAndUpdatedAtBefore(TicketStatus status, LocalDateTime cutoff);

        Optional<Ticket> findByExternalId(String externalId);

        /**
         * 悲观锁查询 — Webhook 并发竞态保护。
         * SELECT ... FOR UPDATE 锁定行，防止同一工单的并发 Webhook 同时触发工作流。
         */
        @Lock(LockModeType.PESSIMISTIC_WRITE)
        @Query("SELECT t FROM Ticket t WHERE t.externalId = :externalId")
        Optional<Ticket> findByExternalIdForUpdate(@Param("externalId") String externalId);

        /**
         * 列表查询（不加载关联数据，避免 N+1）
         */
        @Query("SELECT t FROM Ticket t WHERE " +
                        "(CAST(:status AS string) IS NULL OR t.status = :status) AND " +
                        "(CAST(:externalId AS string) IS NULL OR t.externalId = :externalId) AND " +
                        "(CAST(:subject AS string) IS NULL OR t.subject LIKE %:subject%) AND " +
                        "(CAST(:isValid AS boolean) IS NULL OR t.isValid = :isValid) AND " +
                        "(CAST(:createdAfter AS timestamp) IS NULL OR t.createdAt >= :createdAfter) AND " +
                        "(CAST(:createdBefore AS timestamp) IS NULL OR t.createdAt <= :createdBefore)")
        Page<Ticket> findByFilters(
                        @Param("status") TicketStatus status,
                        @Param("externalId") String externalId,
                        @Param("subject") String subject,
                        @Param("isValid") Boolean isValid,
                        @Param("createdAfter") LocalDateTime createdAfter,
                        @Param("createdBefore") LocalDateTime createdBefore,
                        Pageable pageable);

        /**
         * 单个工单详情查询（JOIN FETCH 一次性加载 translations 和 replies，避免懒加载 N+1）
         */
        @EntityGraph(attributePaths = {"translations", "replies"})
        @Query("SELECT t FROM Ticket t WHERE t.id = :id")
        Optional<Ticket> findByIdWithAssociations(@Param("id") Long id);

        /**
         * 列表查询 — DTO 投影版本，不查 content/lastAuditRemark 等大字段，不触发关联加载。
         * 通过标量子查询获取最新翻译标题（translatedTitle），用于列表中文显示模式。
         */
        @Query("SELECT new com.jefflower.fdserver.ticket.dto.TicketListDTO(" +
                        "t.id, t.externalId, t.subject, t.status, t.createdAt, t.updatedAt, t.isValid, " +
                        "(SELECT tr.translatedTitle FROM TicketTranslation tr WHERE tr.ticket.id = t.id AND tr.id = " +
                        "(SELECT MAX(tr2.id) FROM TicketTranslation tr2 WHERE tr2.ticket.id = t.id)), " +
                        "t.origin, " +
                        "t.fdStatus, t.fdPriority, t.fdRequesterId, t.fdResponderId, t.fdTags, t.fdCreatedAt, t.fdUpdatedAt) " +
                        "FROM Ticket t WHERE " +
                        "(CAST(:status AS string) IS NULL OR t.status = :status) AND " +
                        "(CAST(:externalId AS string) IS NULL OR t.externalId = :externalId) AND " +
                        "(CAST(:subject AS string) IS NULL OR t.subject LIKE %:subject%) AND " +
                        "(CAST(:isValid AS boolean) IS NULL OR t.isValid = :isValid) AND " +
                        "(CAST(:createdAfter AS timestamp) IS NULL OR t.createdAt >= :createdAfter) AND " +
                        "(CAST(:createdBefore AS timestamp) IS NULL OR t.createdAt <= :createdBefore)")
        Page<TicketListDTO> findByFiltersAsDTO(
                        @Param("status") TicketStatus status,
                        @Param("externalId") String externalId,
                        @Param("subject") String subject,
                        @Param("isValid") Boolean isValid,
                        @Param("createdAfter") LocalDateTime createdAfter,
                        @Param("createdBefore") LocalDateTime createdBefore,
                        Pageable pageable);

        @Modifying
        @Query("UPDATE Ticket t SET t.status = :targetStatus, t.updatedAt = :now WHERE t.status = :sourceStatus")
        int updateStatusBatch(
                        @Param("sourceStatus") TicketStatus sourceStatus,
                        @Param("targetStatus") TicketStatus targetStatus,
                        @Param("now") LocalDateTime now);

        /**
         * 修复 version 为 NULL 的历史数据（@Version 乐观锁要求非空）
         */
        @Modifying
        @Query(value = "UPDATE ticket SET version = 0 WHERE version IS NULL", nativeQuery = true)
        int fixNullVersions();
}
