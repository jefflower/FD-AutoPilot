package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.ticket.entity.WebhookEvent;
import com.jefflower.fdserver.ticket.repository.WebhookEventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * Webhook 事件幂等性去重服务。
 * <p>
 * 对每个 Webhook 请求 body 计算 SHA-256 hash 作为 eventId，
 * 通过数据库唯一约束保证同一事件不会被重复处理。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WebhookDeduplicationService {

    private final WebhookEventRepository webhookEventRepository;

    /**
     * 检查并记录 Webhook 事件。
     *
     * @param eventId           事件唯一 ID（webhook:{sha256-hash}）
     * @param eventType         事件类型（ticket_created, ticket_updated 等）
     * @param ticketExternalId  关联的工单外部 ID（可为 null）
     * @return true 表示重复事件（已存在），false 表示首次接收
     */
    @Transactional
    public boolean isDuplicate(String eventId, String eventType, String ticketExternalId) {
        // 先快速查询，大部分情况下事件是首次到达
        if (webhookEventRepository.existsByEventId(eventId)) {
            log.info("Duplicate webhook event detected: eventId={}, type={}", eventId, eventType);
            return true;
        }

        // 首次到达，插入记录
        WebhookEvent event = new WebhookEvent();
        event.setEventId(eventId);
        event.setEventType(eventType);
        event.setTicketExternalId(ticketExternalId);
        event.setReceivedAt(LocalDateTime.now());
        event.setProcessed(false);

        try {
            webhookEventRepository.save(event);
            log.debug("Webhook event recorded: eventId={}, type={}, ticketExternalId={}",
                    eventId, eventType, ticketExternalId);
            return false;
        } catch (DataIntegrityViolationException e) {
            // 并发场景：两个相同请求同时通过 existsByEventId 检查，
            // 唯一约束保证只有一个能插入成功，另一个视为重复
            log.info("Concurrent duplicate webhook event: eventId={}", eventId);
            return true;
        }
    }

    /**
     * 标记事件为已处理。
     *
     * @param eventId 事件唯一 ID
     */
    @Transactional
    public void markProcessed(String eventId) {
        webhookEventRepository.findByEventId(eventId).ifPresent(event -> {
            event.setProcessed(true);
            webhookEventRepository.save(event);
            log.debug("Webhook event marked as processed: eventId={}", eventId);
        });
    }

    /**
     * 定时清理 7 天前的事件记录，避免去重表无限增长。
     * 每天凌晨 4:30 执行。
     */
    @Scheduled(cron = "0 30 4 * * ?")
    @Transactional
    public void cleanupOldEvents() {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(7);
        log.info("Cleaning up webhook events before {}", cutoff);
        webhookEventRepository.deleteByReceivedAtBefore(cutoff);
        log.info("Webhook event cleanup completed");
    }
}
