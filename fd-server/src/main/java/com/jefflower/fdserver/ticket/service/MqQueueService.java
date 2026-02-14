package com.jefflower.fdserver.ticket.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;

/**
 * MQ 队列深度查询服务
 * 通过 RabbitAdmin 的 AMQP 协议查询各队列消息数量
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MqQueueService {

    private final RabbitAdmin rabbitAdmin;
    private final SystemConfigService systemConfigService;

    /**
     * 获取所有业务队列 + DLQ 的消息数量
     */
    public Map<String, Long> getQueueCounts() {
        Map<String, Long> counts = new LinkedHashMap<>();
        counts.put("translation", getMessageCount(systemConfigService.getMqQueueTranslation()));
        counts.put("reply", getMessageCount(systemConfigService.getMqQueueReply()));
        counts.put("audit", getMessageCount(systemConfigService.getMqQueueAudit()));
        counts.put("dlq", getMessageCount(systemConfigService.getMqQueueDlq()));
        return counts;
    }

    private long getMessageCount(String queueName) {
        try {
            Properties props = rabbitAdmin.getQueueProperties(queueName);
            if (props != null) {
                Object count = props.get(RabbitAdmin.QUEUE_MESSAGE_COUNT);
                if (count instanceof Number) {
                    return ((Number) count).longValue();
                }
            }
        } catch (Exception e) {
            log.warn("Failed to get message count for queue {}: {}", queueName, e.getMessage());
        }
        return 0;
    }
}
