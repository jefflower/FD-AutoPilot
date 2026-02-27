package com.jefflower.fdserver.ticket.config;

import com.jefflower.fdserver.ticket.service.FlowableTicketOrchestrator;
import com.jefflower.fdserver.ticket.service.TicketWorkflowOrchestrator;
import com.jefflower.fdserver.workflow.service.WorkflowService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class WorkflowOrchestratorConfig {

    @Bean
    public TicketWorkflowOrchestrator flowableOrchestrator(WorkflowService workflowService) {
        return new FlowableTicketOrchestrator(workflowService);
    }
}
