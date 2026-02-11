package com.jefflower.fdserver.service;

import com.jefflower.fdserver.entity.Ticket;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class MqPublisherService {

    private final RabbitTemplate rabbitTemplate;
    private final SystemConfigService systemConfigService;

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
                    log.info("Sending message to {} with ticketId: {} (after commit)", routingKey, ticket.getId());
                    rabbitTemplate.convertAndSend(exchange, routingKey, message);
                }
            });
        } else {
            // 不在事务内：立即发送
            log.info("Sending message to {} with ticketId: {} (immediate)", routingKey, ticket.getId());
            rabbitTemplate.convertAndSend(exchange, routingKey, message);
        }
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
