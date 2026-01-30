package com.jefflower.fdserver.config;

import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitMQConfig {

    public static final String EXCHANGE = "fd.ticket.task.exchange";

    public static final String QUEUE_TRANSLATION = "q.ticket.translation";
    public static final String QUEUE_REPLY = "q.ticket.reply";
    public static final String QUEUE_AUDIT = "q.ticket.audit";
    public static final String QUEUE_DLQ = "q.ticket.dlq";

    public static final String ROUTING_TRANSLATE = "ticket.task.translate";
    public static final String ROUTING_REPLY = "ticket.task.reply";
    public static final String ROUTING_AUDIT = "ticket.task.audit";

    @Bean
    public TopicExchange exchange() {
        return new TopicExchange(EXCHANGE);
    }

    @Bean
    public Queue translationQueue() {
        return QueueBuilder.durable(QUEUE_TRANSLATION)
                .withArgument("x-dead-letter-exchange", "")
                .withArgument("x-dead-letter-routing-key", QUEUE_DLQ)
                .build();
    }

    @Bean
    public Queue replyQueue() {
        return QueueBuilder.durable(QUEUE_REPLY)
                .withArgument("x-dead-letter-exchange", "")
                .withArgument("x-dead-letter-routing-key", QUEUE_DLQ)
                .build();
    }

    @Bean
    public Queue auditQueue() {
        return QueueBuilder.durable(QUEUE_AUDIT)
                .withArgument("x-dead-letter-exchange", "")
                .withArgument("x-dead-letter-routing-key", QUEUE_DLQ)
                .build();
    }

    @Bean
    public Queue dlq() {
        return QueueBuilder.durable(QUEUE_DLQ).build();
    }

    @Bean
    public Binding translationBinding(Queue translationQueue, TopicExchange exchange) {
        return BindingBuilder.bind(translationQueue).to(exchange).with(ROUTING_TRANSLATE);
    }

    @Bean
    public Binding replyBinding(Queue replyQueue, TopicExchange exchange) {
        return BindingBuilder.bind(replyQueue).to(exchange).with(ROUTING_REPLY);
    }

    @Bean
    public Binding auditBinding(Queue auditQueue, TopicExchange exchange) {
        return BindingBuilder.bind(auditQueue).to(exchange).with(ROUTING_AUDIT);
    }

    @Bean
    public MessageConverter jsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(jsonMessageConverter());
        return template;
    }
}
