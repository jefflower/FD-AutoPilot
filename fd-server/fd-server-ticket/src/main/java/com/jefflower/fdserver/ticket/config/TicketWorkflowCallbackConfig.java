package com.jefflower.fdserver.ticket.config;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketReply;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.repository.TicketReplyRepository;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import com.jefflower.fdserver.ticket.service.*;
import com.jefflower.fdserver.ticket.service.notify.NotifyService;
import com.jefflower.fdserver.workflow.service.WorkflowCallbackRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * Flowable 模式下的工单业务回调注册。
 * <p>
 * 将工单业务逻辑注册到 WorkflowCallbackRegistry，
 * 由 BPMN 流程中的 BusinessCallbackDelegate 在适当时机调用。
 */
@Slf4j
@Component
@Order(15)
@ConditionalOnProperty(name = "fd.workflow.enabled", havingValue = "true")
public class TicketWorkflowCallbackConfig implements CommandLineRunner {

    private final WorkflowCallbackRegistry callbackRegistry;
    private final TicketRepository ticketRepository;
    private final TicketReplyRepository replyRepository;
    private final TicketStateMachine stateMachine;
    private final ReplyPushService replyPushService;
    private final SystemConfigService systemConfigService;
    private final NotifyService notifyService;
    private final AuditTokenService auditTokenService;

    public TicketWorkflowCallbackConfig(WorkflowCallbackRegistry callbackRegistry,
                                         TicketRepository ticketRepository,
                                         TicketReplyRepository replyRepository,
                                         TicketStateMachine stateMachine,
                                         ReplyPushService replyPushService,
                                         SystemConfigService systemConfigService,
                                         NotifyService notifyService,
                                         AuditTokenService auditTokenService) {
        this.callbackRegistry = callbackRegistry;
        this.ticketRepository = ticketRepository;
        this.replyRepository = replyRepository;
        this.stateMachine = stateMachine;
        this.replyPushService = replyPushService;
        this.systemConfigService = systemConfigService;
        this.notifyService = notifyService;
        this.auditTokenService = auditTokenService;
    }

    @Override
    public void run(String... args) {
        registerTranslationDone();
        registerReplyDone();
        registerAuditPass();
        registerAuditReject();
        log.info("[TicketWorkflowCallbackConfig] All ticket workflow callbacks registered");
    }

    private void registerTranslationDone() {
        callbackRegistry.register("ticket.translationDone", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);
            if (ticket.getStatus() != TicketStatus.PENDING_REPLY) {
                stateMachine.transition(ticket, TicketStatus.PENDING_REPLY);
                ticketRepository.save(ticket);
            }
        });
    }

    private void registerReplyDone() {
        callbackRegistry.register("ticket.replyDone", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);
            stateMachine.transition(ticket, TicketStatus.PENDING_AUDIT);
            ticketRepository.save(ticket);

            String auditToken = auditTokenService.generateToken(ticket.getId());
            notifyService.notifyPendingAudit(ticket, auditToken);
        });
    }

    private void registerAuditPass() {
        callbackRegistry.register("ticket.auditPass", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);

            Long replyId = toLong(vars.get("replyId"));
            if (replyId != null) {
                TicketReply reply = replyRepository.findById(replyId)
                        .orElseThrow(() -> new BusinessException(ErrorCode.REPLY_NOT_FOUND));
                reply.setIsSelected(true);
                replyRepository.save(reply);

                boolean autoReply = systemConfigService.isAutoReplyEnabled();
                if (autoReply) {
                    stateMachine.transition(ticket, TicketStatus.COMPLETED);
                    replyPushService.pushReplyToFreshdesk(ticket, reply);
                } else {
                    stateMachine.transition(ticket, TicketStatus.APPROVED);
                }
            } else {
                stateMachine.transition(ticket, TicketStatus.APPROVED);
            }

            ticket.setLastAuditRemark(null);
            ticketRepository.save(ticket);
            notifyService.notifyAuditPass(ticket);
        });
    }

    private void registerAuditReject() {
        callbackRegistry.register("ticket.auditReject", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);

            String auditRemark = vars.get("auditRemark") != null ? vars.get("auditRemark").toString() : null;
            stateMachine.transition(ticket, TicketStatus.PENDING_REPLY);
            ticket.setLastAuditRemark(auditRemark);
            ticketRepository.save(ticket);

            notifyService.notifyAuditReject(ticket, auditRemark);
            // 注意：BPMN 流程会自动循环回 reply_agent，由 AgentTaskDelegate 创建回复任务
        });
    }

    private Ticket findTicket(String businessKey) {
        Long ticketId = Long.parseLong(businessKey);
        return ticketRepository.findById(ticketId)
                .orElseThrow(() -> new BusinessException(ErrorCode.TICKET_NOT_FOUND,
                        "Workflow callback: ticket not found: " + businessKey));
    }

    private Long toLong(Object value) {
        if (value == null) return null;
        if (value instanceof Long l) return l;
        if (value instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(value.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
