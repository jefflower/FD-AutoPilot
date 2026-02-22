package com.jefflower.fdserver.ticket.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import com.jefflower.fdserver.ticket.repository.TicketReplyRepository;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import com.jefflower.fdserver.ticket.service.*;
import com.jefflower.fdserver.ticket.service.notify.NotifyService;
import com.jefflower.fdserver.workflow.service.WorkflowService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class WorkflowOrchestratorConfig {

    @Bean
    @ConditionalOnProperty(name = "fd.workflow.enabled", havingValue = "false", matchIfMissing = true)
    public TicketWorkflowOrchestrator legacyOrchestrator(
            TaskDistributionService taskDistributionService,
            TicketStateMachine stateMachine,
            TicketRepository ticketRepository,
            TicketReplyRepository replyRepository,
            ReplyPushService replyPushService,
            SystemConfigService systemConfigService,
            NotifyService notifyService,
            AuditTokenService auditTokenService,
            ObjectMapper objectMapper) {
        return new LegacyTicketOrchestrator(
                taskDistributionService, stateMachine, ticketRepository,
                replyRepository, replyPushService, systemConfigService,
                notifyService, auditTokenService, objectMapper);
    }

    @Bean
    @ConditionalOnProperty(name = "fd.workflow.enabled", havingValue = "true")
    public TicketWorkflowOrchestrator flowableOrchestrator(WorkflowService workflowService) {
        return new FlowableTicketOrchestrator(workflowService);
    }
}
