package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.WebhookEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.Optional;

@Repository
public interface WebhookEventRepository extends JpaRepository<WebhookEvent, Long> {

    /** 检查事件是否已记录 */
    boolean existsByEventId(String eventId);

    /** 根据 eventId 查找事件记录 */
    Optional<WebhookEvent> findByEventId(String eventId);

    /** 删除指定时间之前的旧记录（定期清理） */
    void deleteByReceivedAtBefore(LocalDateTime cutoff);

    /** 统计指定时间之后的事件数 */
    long countByReceivedAtAfter(LocalDateTime since);

    /** 按处理状态统计事件数 */
    long countByProcessed(boolean processed);
}
