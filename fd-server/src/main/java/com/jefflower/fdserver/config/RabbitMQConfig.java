package com.jefflower.fdserver.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Slf4j
@Configuration
public class RabbitMQConfig {

    public static final String DLQ_NAME = "q.ticket.dlq";

    @Bean
    public RabbitAdmin rabbitAdmin(ConnectionFactory connectionFactory) {
        return new RabbitAdmin(connectionFactory);
    }

    @Bean
    public MessageConverter jsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(jsonMessageConverter());

        // 启用 mandatory 模式：消息无法路由到队列时触发 ReturnCallback
        template.setMandatory(true);

        // Publisher Confirm 回调：消息到达 Broker（Exchange）后的确认
        template.setConfirmCallback((correlationData, ack, cause) -> {
            if (ack) {
                log.debug("[MQ-Confirm] 消息发送成功确认, correlationData={}", correlationData);
            } else {
                log.error("[MQ-Confirm] 消息发送到交换机失败, correlationData={}, cause={}", correlationData, cause);
            }
        });

        // Publisher Return 回调：消息无法路由到队列时触发
        template.setReturnsCallback(returned -> {
            log.error("[MQ-Return] 消息无法路由到队列! exchange={}, routingKey={}, replyCode={}, replyText={}, message={}",
                    returned.getExchange(),
                    returned.getRoutingKey(),
                    returned.getReplyCode(),
                    returned.getReplyText(),
                    returned.getMessage());
        });

        return template;
    }

    /**
     * 声明死信队列（确保存在）
     */
    @Bean
    public Queue deadLetterQueue() {
        return QueueBuilder.durable(DLQ_NAME).build();
    }
}
