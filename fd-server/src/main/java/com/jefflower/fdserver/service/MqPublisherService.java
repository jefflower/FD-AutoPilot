package com.jefflower.fdserver.service;

import com.jefflower.fdserver.entity.Ticket;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Slf4j
@Service
@RequiredArgsConstructor
public class MqPublisherService {

    private final RabbitTemplate rabbitTemplate;
    private final SystemConfigService systemConfigService;

    /** 最大重试次数 */
    private static final int MAX_RETRIES = 3;
    /** 初始退避时间（毫秒） */
    private static final long INITIAL_BACKOFF_MS = 500;
    /** Publisher Confirm 等待超时（秒） */
    private static final long CONFIRM_TIMEOUT_SECONDS = 5;

    public void sendTranslationTask(Ticket ticket) {
        sendTask(systemConfigService.getMqRoutingTranslate(), ticket);
    }

    public void sendReplyTask(Ticket ticket) {
        sendTask(systemConfigService.getMqRoutingReply(), ticket);
    }

    public void sendAuditTask(Ticket ticket) {
        sendTask(systemConfigService.getMqRoutingAudit(), ticket);
    }

    private void sendTask(String routingKey, Ticket ticket) {
        // 预先构建消息，捕获当前值（事务提交后 ticket 状态可能变化）
        Map<String, Object> message = buildMessage(routingKey, ticket);
        String exchange = systemConfigService.getMqExchange();

        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            // 在事务内：延迟到事务提交后再发送，避免消费者在 DB 数据未提交时就拿到消息
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    sendWithRetry(exchange, routingKey, message, ticket.getId());
                }
            });
        } else {
            // 不在事务内：立即发送
            sendWithRetry(exchange, routingKey, message, ticket.getId());
        }
    }

    /**
     * 带重试机制的消息发送，使用 Publisher Confirm 验证消息是否成功到达 Broker
     * 失败时采用指数退避重试（最多 MAX_RETRIES 次）
     */
    private void sendWithRetry(String exchange, String routingKey, Map<String, Object> message, Long ticketId) {
        for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                String correlationId = UUID.randomUUID().toString();
                CorrelationData correlationData = new CorrelationData(correlationId);

                log.info("[MQ-Send] 发送消息到 {}, ticketId={}, attempt={}/{}, correlationId={}",
                        routingKey, ticketId, attempt, MAX_RETRIES, correlationId);

                rabbitTemplate.convertAndSend(exchange, routingKey, message, correlationData);

                // 等待 Publisher Confirm 结果
                CorrelationData.Confirm confirm = correlationData.getFuture().get(CONFIRM_TIMEOUT_SECONDS, TimeUnit.SECONDS);

                if (confirm != null && confirm.isAck()) {
                    log.info("[MQ-Send] 消息发送成功确认, ticketId={}, routingKey={}, correlationId={}",
                            ticketId, routingKey, correlationId);
                    return; // 发送成功，直接返回
                } else {
                    String reason = confirm != null ? confirm.getReason() : "confirm timeout or null";
                    log.warn("[MQ-Send] 消息发送未确认, ticketId={}, routingKey={}, attempt={}/{}, reason={}",
                            ticketId, routingKey, attempt, MAX_RETRIES, reason);
                }
            } catch (Exception e) {
                log.error("[MQ-Send] 消息发送异常, ticketId={}, routingKey={}, attempt={}/{}, error={}",
                        ticketId, routingKey, attempt, MAX_RETRIES, e.getMessage());
            }

            // 如果不是最后一次尝试，进行指数退避等待
            if (attempt < MAX_RETRIES) {
                long backoffMs = INITIAL_BACKOFF_MS * (1L << (attempt - 1)); // 500ms, 1000ms, 2000ms...
                log.info("[MQ-Send] 等待 {}ms 后重试, ticketId={}", backoffMs, ticketId);
                try {
                    Thread.sleep(backoffMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    log.warn("[MQ-Send] 重试等待被中断, ticketId={}", ticketId);
                    break;
                }
            }
        }

        // 所有重试都失败
        log.error("[MQ-Send] 消息发送最终失败, ticketId={}, routingKey={}, 已重试{}次", ticketId, routingKey, MAX_RETRIES);
    }

    private Map<String, Object> buildMessage(String routingKey, Ticket ticket) {
        Map<String, Object> message = new HashMap<>();
        message.put("msgId", UUID.randomUUID().toString());
        message.put("ticketId", ticket.getId());
        message.put("timestamp", System.currentTimeMillis());

        Map<String, Object> payload = new HashMap<>();
        payload.put("externalId", ticket.getExternalId());
        payload.put("subject", ticket.getSubject());
        payload.put("content", ticket.getContent());
        if (ticket.getLastAuditRemark() != null) {
            payload.put("auditRemark", ticket.getLastAuditRemark());
        }
        message.put("payload", payload);

        log.info("Building message for {} with ticketId: {}. Payload content len: {}",
                routingKey, ticket.getId(),
                payload.get("content") != null ? ((String) payload.get("content")).length() : 0);
        return message;
    }
}
