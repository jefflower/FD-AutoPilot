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

    // 默认队列/交换机/路由键（与 SystemConfigService 默认值一致）
    public static final String EXCHANGE_NAME = "fd.ticket.task.exchange";
    public static final String QUEUE_TRANSLATION = "q.ticket.translation";
    public static final String QUEUE_REPLY = "q.ticket.reply";
    public static final String QUEUE_AUDIT = "q.ticket.audit";
    public static final String ROUTING_TRANSLATE = "ticket.task.translate";
    public static final String ROUTING_REPLY = "ticket.task.reply";
    public static final String ROUTING_AUDIT = "ticket.task.audit";

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

    // ========== Exchange ==========

    @Bean
    public TopicExchange ticketTaskExchange() {
        return ExchangeBuilder.topicExchange(EXCHANGE_NAME).durable(true).build();
    }

    // ========== Queues ==========

    @Bean
    public Queue translationQueue() {
        return QueueBuilder.durable(QUEUE_TRANSLATION)
                .withArgument("x-dead-letter-exchange", "")
                .withArgument("x-dead-letter-routing-key", DLQ_NAME)
                .build();
    }

    @Bean
    public Queue replyQueue() {
        return QueueBuilder.durable(QUEUE_REPLY)
                .withArgument("x-dead-letter-exchange", "")
                .withArgument("x-dead-letter-routing-key", DLQ_NAME)
                .build();
    }

    @Bean
    public Queue auditQueue() {
        return QueueBuilder.durable(QUEUE_AUDIT)
                .withArgument("x-dead-letter-exchange", "")
                .withArgument("x-dead-letter-routing-key", DLQ_NAME)
                .build();
    }

    @Bean
    public Queue deadLetterQueue() {
        return QueueBuilder.durable(DLQ_NAME).build();
    }

    // ========== Bindings ==========

    @Bean
    public Binding translationBinding(Queue translationQueue, TopicExchange ticketTaskExchange) {
        return BindingBuilder.bind(translationQueue).to(ticketTaskExchange).with(ROUTING_TRANSLATE);
    }

    @Bean
    public Binding replyBinding(Queue replyQueue, TopicExchange ticketTaskExchange) {
        return BindingBuilder.bind(replyQueue).to(ticketTaskExchange).with(ROUTING_REPLY);
    }

    @Bean
    public Binding auditBinding(Queue auditQueue, TopicExchange ticketTaskExchange) {
        return BindingBuilder.bind(auditQueue).to(ticketTaskExchange).with(ROUTING_AUDIT);
    }
}
