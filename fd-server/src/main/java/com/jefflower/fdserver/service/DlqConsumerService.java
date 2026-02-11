package com.jefflower.fdserver.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.config.RabbitMQConfig;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * 死信队列消费者
 * 消费进入 DLQ 的失败消息，记录详细日志，并提供手动重投能力
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DlqConsumerService {

    private final RabbitTemplate rabbitTemplate;
    private final SystemConfigService systemConfigService;
    private final ObjectMapper objectMapper;

    /**
     * 监听死信队列，记录失败消息详情
     */
    @RabbitListener(queues = RabbitMQConfig.DLQ_NAME)
    public void handleDeadLetterMessage(Message message) {
        String body = new String(message.getBody(), StandardCharsets.UTF_8);
        Map<String, Object> headers = message.getMessageProperties().getHeaders();

        // 提取死信元数据
        String originalExchange = String.valueOf(headers.getOrDefault("x-first-death-exchange", "unknown"));
        String originalQueue = String.valueOf(headers.getOrDefault("x-first-death-queue", "unknown"));
        String deathReason = String.valueOf(headers.getOrDefault("x-first-death-reason", "unknown"));

        log.error("[DLQ] 收到死信消息! originalExchange={}, originalQueue={}, deathReason={}, body={}",
                originalExchange, originalQueue, deathReason, body);

        // 尝试解析出 ticketId 供日志追踪
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> messageMap = objectMapper.readValue(body, Map.class);
            Object ticketId = messageMap.get("ticketId");
            Object msgId = messageMap.get("msgId");
            log.error("[DLQ] 死信消息详情: ticketId={}, msgId={}, originalQueue={}",
                    ticketId, msgId, originalQueue);
        } catch (Exception e) {
            log.error("[DLQ] 无法解析死信消息内容: {}", e.getMessage());
        }
    }

    /**
     * 手动将死信队列中的消息重新投递到原始队列
     * 注意：此方法会从 DLQ 中取出一条消息并重新发送
     *
     * @param targetRoutingKey 目标路由键（如 ticket.task.translate）
     * @return 是否成功重投
     */
    public boolean requeueDeadLetter(String targetRoutingKey) {
        Message message = rabbitTemplate.receive(RabbitMQConfig.DLQ_NAME, 3000);
        if (message == null) {
            log.info("[DLQ] 死信队列为空，无消息可重投");
            return false;
        }

        String exchange = systemConfigService.getMqExchange();
        String body = new String(message.getBody(), StandardCharsets.UTF_8);
        log.info("[DLQ] 重投死信消息到 exchange={}, routingKey={}, body={}", exchange, targetRoutingKey, body);

        rabbitTemplate.convertAndSend(exchange, targetRoutingKey, message);
        return true;
    }

    /**
     * 批量重投死信队列中的所有消息到指定路由键
     *
     * @param targetRoutingKey 目标路由键
     * @return 重投的消息数量
     */
    public int requeueAllDeadLetters(String targetRoutingKey) {
        int count = 0;
        while (requeueDeadLetter(targetRoutingKey)) {
            count++;
            if (count > 1000) {
                log.warn("[DLQ] 批量重投超过 1000 条，中止以防死循环");
                break;
            }
        }
        log.info("[DLQ] 批量重投完成，共重投 {} 条消息到 {}", count, targetRoutingKey);
        return count;
    }
}
