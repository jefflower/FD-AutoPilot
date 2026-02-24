package com.jefflower.fdserver.ticket.config;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketReply;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.repository.TicketReplyRepository;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import com.jefflower.fdserver.ticket.service.*;
import com.jefflower.fdserver.ticket.service.notify.NotifyService;
import com.jefflower.fdserver.workflow.service.WorkflowCallbackRegistry;
import lombok.extern.slf4j.Slf4j;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
    private final TaskInstanceRepository taskInstanceRepository;
    private final TicketStateMachine stateMachine;
    private final ReplyPushService replyPushService;
    private final SystemConfigService systemConfigService;
    private final NotifyService notifyService;
    private final AuditTokenService auditTokenService;

    public TicketWorkflowCallbackConfig(WorkflowCallbackRegistry callbackRegistry,
                                         TicketRepository ticketRepository,
                                         TicketReplyRepository replyRepository,
                                         TaskInstanceRepository taskInstanceRepository,
                                         TicketStateMachine stateMachine,
                                         ReplyPushService replyPushService,
                                         SystemConfigService systemConfigService,
                                         NotifyService notifyService,
                                         AuditTokenService auditTokenService) {
        this.callbackRegistry = callbackRegistry;
        this.ticketRepository = ticketRepository;
        this.replyRepository = replyRepository;
        this.taskInstanceRepository = taskInstanceRepository;
        this.stateMachine = stateMachine;
        this.replyPushService = replyPushService;
        this.systemConfigService = systemConfigService;
        this.notifyService = notifyService;
        this.auditTokenService = auditTokenService;
    }

    @Override
    public void run(String... args) {
        // 迁移清理：取消旧 Legacy 模式创建的任务（不含 processInstanceId）
        cleanupLegacyTasks();

        // 注册业务数据提供者
        registerTicketDataProvider();

        registerTranslationDone();
        registerReplyDone();
        registerBothDone();
        registerAuditPass();
        registerAuditReject();
        log.info("[TicketWorkflowCallbackConfig] All ticket workflow callbacks registered");
    }

    /**
     * 清理旧 Legacy 模式创建的 PENDING/CLAIMED 任务。
     * <p>
     * 当从 Legacy 模式切换到 Flowable BPMN 模式时，旧的任务（payload 不含 processInstanceId）
     * 会阻塞客户端消费 BPMN 创建的新任务（因为 claim API 按 ID 排序，旧任务 ID 更小优先被领取）。
     * 旧任务完成后因无 processInstanceId 无法触发工作流推进，导致整个流程卡住。
     */
    private void cleanupLegacyTasks() {
        List<TaskInstance> legacyPending = taskInstanceRepository.findAll().stream()
                .filter(t -> t.getStatus() == TaskStatus.PENDING || t.getStatus() == TaskStatus.CLAIMED)
                .filter(t -> t.getPayload() == null || !t.getPayload().contains("processInstanceId"))
                .filter(t -> t.getTaskType().startsWith("ticket."))
                .toList();

        if (legacyPending.isEmpty()) {
            log.info("[TicketWorkflowCallbackConfig] No legacy tasks to cleanup");
            return;
        }

        int count = 0;
        for (TaskInstance task : legacyPending) {
            task.setStatus(TaskStatus.CANCELLED);
            taskInstanceRepository.save(task);
            count++;
        }
        log.warn("[TicketWorkflowCallbackConfig] Cancelled {} legacy tasks (no processInstanceId) — " +
                "these were created before switching to Flowable BPMN mode", count);
    }

    private void registerTicketDataProvider() {
        callbackRegistry.registerDataProvider("ticket", businessKey -> {
            Long ticketId = Long.parseLong(businessKey);
            Ticket ticket = ticketRepository.findById(ticketId)
                    .orElseThrow(() -> new BusinessException(ErrorCode.TICKET_NOT_FOUND,
                            "Data provider: ticket not found: " + businessKey));
            Map<String, Object> data = new java.util.HashMap<>();
            data.put("id", ticket.getId());
            data.put("subject", ticket.getSubject());
            data.put("content", ticket.getContent());
            if (ticket.getLastAuditRemark() != null) {
                data.put("lastAuditRemark", ticket.getLastAuditRemark());
            }
            return data;
        });
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
            // 并行网关模式下，回复完成时翻译可能还没完成。
            // 不设置 PENDING_AUDIT 状态，不发送审核通知。
            // 审核创建在 bothDone 回调中统一完成（并行汇聚后触发）。
            log.info("[TicketWorkflowCallback] replyDone for ticket {}, waiting for parallel join", businessKey);
        });
    }

    private void registerBothDone() {
        callbackRegistry.register("ticket.bothDone", (businessKey, vars) -> {
            Ticket ticket = findTicket(businessKey);
            stateMachine.transition(ticket, TicketStatus.PENDING_AUDIT);
            ticketRepository.save(ticket);

            String auditToken = auditTokenService.generateToken(ticket.getId());
            notifyService.notifyPendingAudit(ticket, auditToken);
            log.info("[TicketWorkflowCallback] bothDone for ticket {}, transitioned to PENDING_AUDIT", businessKey);
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
