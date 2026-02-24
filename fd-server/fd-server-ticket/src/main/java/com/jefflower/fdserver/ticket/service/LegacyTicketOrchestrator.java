package com.jefflower.fdserver.ticket.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.task.enums.TriggerType;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketReply;
import com.jefflower.fdserver.ticket.enums.AuditResult;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.repository.TicketReplyRepository;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import com.jefflower.fdserver.ticket.service.notify.NotifyService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.util.Map;

/**
 * 旧版工单流程编排 — 硬编码状态转换 + TaskInstance 创建。
 * <p>
 * 从 TicketService 提取的原有逻辑，当 fd.workflow.enabled=false 时使用。
 */
@Slf4j
@RequiredArgsConstructor
public class LegacyTicketOrchestrator implements TicketWorkflowOrchestrator {

    private final TaskDistributionService taskDistributionService;
    private final TicketStateMachine stateMachine;
    private final TicketRepository ticketRepository;
    private final TicketReplyRepository replyRepository;
    private final ReplyPushService replyPushService;
    private final SystemConfigService systemConfigService;
    private final NotifyService notifyService;
    private final AuditTokenService auditTokenService;
    private final ObjectMapper objectMapper;

    @Override
    public void onNewTicket(Ticket ticket) {
        taskDistributionService.createTask("ticket.translate", "ticket",
                String.valueOf(ticket.getId()), buildTaskPayload(ticket), TriggerType.EVENT);
    }

    @Override
    public void onTranslationCompleted(Ticket ticket) {
        taskDistributionService.completeByReference("ticket.translate", String.valueOf(ticket.getId()));

        if (ticket.getStatus() != TicketStatus.PENDING_REPLY) {
            stateMachine.transition(ticket, TicketStatus.PENDING_REPLY);
            ticketRepository.save(ticket);

            taskDistributionService.createTask("ticket.reply", "ticket",
                    String.valueOf(ticket.getId()), buildTaskPayload(ticket), TriggerType.EVENT);
        }
    }

    @Override
    public void onReplyCompleted(Ticket ticket) {
        stateMachine.transition(ticket, TicketStatus.PENDING_AUDIT);
        ticketRepository.save(ticket);

        taskDistributionService.completeByReference("ticket.reply", String.valueOf(ticket.getId()));

        taskDistributionService.createTask("ticket.audit", "ticket",
                String.valueOf(ticket.getId()), buildTaskPayload(ticket), TriggerType.EVENT);

        String auditToken = auditTokenService.generateToken(ticket.getId());
        notifyService.notifyPendingAudit(ticket, auditToken);
    }

    @Override
    public void onAuditCompleted(Ticket ticket, AuditResult result, String auditRemark,
                                  Long replyId, Long auditorId) {
        taskDistributionService.completeByReference("ticket.audit", String.valueOf(ticket.getId()));

        if (result == AuditResult.PASS) {
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
            ticket.setLastAuditRemark(null);
            ticketRepository.save(ticket);

            notifyService.notifyAuditPass(ticket);
        } else if (result == AuditResult.RETRANSLATE) {
            stateMachine.transition(ticket, TicketStatus.PENDING_TRANS);
            ticket.setLastAuditRemark(auditRemark);
            ticketRepository.save(ticket);

            taskDistributionService.createTask("ticket.translate", "ticket",
                    String.valueOf(ticket.getId()), buildTaskPayload(ticket), TriggerType.EVENT);

            notifyService.notifyAuditReject(ticket, auditRemark);
        } else {
            stateMachine.transition(ticket, TicketStatus.PENDING_REPLY);
            ticket.setLastAuditRemark(auditRemark);
            ticketRepository.save(ticket);

            taskDistributionService.createTask("ticket.reply", "ticket",
                    String.valueOf(ticket.getId()), buildTaskPayload(ticket), TriggerType.EVENT);

            notifyService.notifyAuditReject(ticket, auditRemark);
        }
    }

    private String buildTaskPayload(Ticket ticket) {
        Map<String, Object> payload = Map.of(
                "ticketId", ticket.getId(),
                "externalId", ticket.getExternalId() != null ? ticket.getExternalId() : "",
                "subject", ticket.getSubject() != null ? ticket.getSubject() : ""
        );
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            return String.format("{\"ticketId\":%d}", ticket.getId());
        }
    }
}
