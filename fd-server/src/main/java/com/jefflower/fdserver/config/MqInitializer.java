package com.jefflower.fdserver.config;

import com.jefflower.fdserver.service.SystemConfigService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class MqInitializer implements ApplicationRunner {

    private final RabbitAdmin rabbitAdmin;
    private final SystemConfigService configService;

    @Override
    public void run(ApplicationArguments args) {
        String exchange = configService.getMqExchange();
        String queueTranslation = configService.getMqQueueTranslation();
        String queueReply = configService.getMqQueueReply();
        String queueAudit = configService.getMqQueueAudit();
        String queueDlq = configService.getMqQueueDlq();
        String routingTranslate = configService.getMqRoutingTranslate();
        String routingReply = configService.getMqRoutingReply();
        String routingAudit = configService.getMqRoutingAudit();

        log.info("初始化 MQ 队列 (从数据库配置): exchange={}, translation={}, reply={}, audit={}, dlq={}",
                exchange, queueTranslation, queueReply, queueAudit, queueDlq);

        // Declare exchange
        TopicExchange topicExchange = new TopicExchange(exchange);
        rabbitAdmin.declareExchange(topicExchange);

        // Declare DLQ
        Queue dlq = QueueBuilder.durable(queueDlq).build();
        rabbitAdmin.declareQueue(dlq);

        // Declare business queues with DLQ
        Queue translationQ = QueueBuilder.durable(queueTranslation)
                .withArgument("x-dead-letter-exchange", "")
                .withArgument("x-dead-letter-routing-key", queueDlq)
                .build();
        Queue replyQ = QueueBuilder.durable(queueReply)
                .withArgument("x-dead-letter-exchange", "")
                .withArgument("x-dead-letter-routing-key", queueDlq)
                .build();
        Queue auditQ = QueueBuilder.durable(queueAudit)
                .withArgument("x-dead-letter-exchange", "")
                .withArgument("x-dead-letter-routing-key", queueDlq)
                .build();
        rabbitAdmin.declareQueue(translationQ);
        rabbitAdmin.declareQueue(replyQ);
        rabbitAdmin.declareQueue(auditQ);

        // Declare bindings
        rabbitAdmin.declareBinding(BindingBuilder.bind(translationQ).to(topicExchange).with(routingTranslate));
        rabbitAdmin.declareBinding(BindingBuilder.bind(replyQ).to(topicExchange).with(routingReply));
        rabbitAdmin.declareBinding(BindingBuilder.bind(auditQ).to(topicExchange).with(routingAudit));

        log.info("MQ 队列初始化完成");
    }
}
