package com.jefflower.fdserver.service;

import com.jefflower.fdserver.entity.Ticket;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class MqPublisherService {

    private final RabbitTemplate rabbitTemplate;

    private static final String EXCHANGE = "fd.ticket.task.exchange";

    public void sendTranslationTask(Ticket ticket) {
        sendTask("ticket.task.translate", ticket);
    }

    public void sendReplyTask(Ticket ticket) {
        sendTask("ticket.task.reply", ticket);
    }

    public void sendAuditTask(Ticket ticket) {
        sendTask("ticket.task.audit", ticket);
    }

    private void sendTask(String routingKey, Ticket ticket) {
        Map<String, Object> message = new HashMap<>();
        message.put("msgId", UUID.randomUUID().toString());
        message.put("ticketId", ticket.getId());
        message.put("timestamp", System.currentTimeMillis());

        Map<String, Object> payload = new HashMap<>();
        payload.put("externalId", ticket.getExternalId());
        payload.put("subject", ticket.getSubject());
        payload.put("content", ticket.getContent());
        message.put("payload", payload);

        log.info("Sending message to {} with ticketId: {}. Payload content len: {}",
                routingKey, ticket.getId(),
                payload.get("content") != null ? ((String) payload.get("content")).length() : 0);
        rabbitTemplate.convertAndSend(EXCHANGE, routingKey, message);
    }
}
