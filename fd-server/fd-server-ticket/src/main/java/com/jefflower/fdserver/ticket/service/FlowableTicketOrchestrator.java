package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.enums.AuditResult;
import com.jefflower.fdserver.workflow.service.WorkflowService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.util.HashMap;
import java.util.Map;

/**
 * Flowable 工作流编排 — 委托 BPMN 引擎处理流程推进。
 * <p>
 * 当 fd.workflow.enabled=true 时使用。
 * 数据保存在 TicketService 中完成，此处仅负责启动流程和唤醒 BPMN ReceiveTask。
 * <p>
 * 并行网关模式下：
 * - onNewTicket: 启动 BPMN 流程实例
 * - onTranslationCompleted / onReplyCompleted: no-op（CLIENT_ONLY Agent 完成任务后，
 *   task 模块发布 TaskCompletedEvent -> workflow 模块的 WorkflowTaskCompletionListener
 *   自动桥接到 WorkflowTaskBridge -> 唤醒 ReceiveTask）
 * - onAuditCompleted: 手动 signal audit_create_wait（审核是人工完成而非 Agent 任务）
 */
@Slf4j
@RequiredArgsConstructor
public class FlowableTicketOrchestrator implements TicketWorkflowOrchestrator {

    private final WorkflowService workflowService;

    @Override
    public void onNewTicket(Ticket ticket) {
        String businessKey = String.valueOf(ticket.getId());
        try {
            String processInstanceId = workflowService.startProcess(
                    "ticket-standard-flow", businessKey, Map.of());
            log.info("[FlowableOrchestrator] Started BPMN process for ticket #{}, processInstanceId={}",
                    ticket.getId(), processInstanceId);
        } catch (Exception e) {
            log.error("[FlowableOrchestrator] Failed to start process for ticket #{}: {}",
                    ticket.getId(), e.getMessage(), e);
            throw e;
        }
    }

    @Override
    public void onTranslationCompleted(Ticket ticket) {
        // No-op: 在并行网关模式下，CLIENT_ONLY Agent 完成任务后，
        // task 模块的 TaskCompletedEvent -> WorkflowTaskCompletionListener -> WorkflowTaskBridge
        // 自动唤醒对应的 ReceiveTask，无需手动 signal。
        log.debug("[FlowableOrchestrator] onTranslationCompleted for ticket #{} — " +
                "no-op, workflow auto-bridges via TaskCompletedEvent", ticket.getId());
    }

    @Override
    public boolean isFlowableMode() {
        return true;
    }

    @Override
    public void onReplyCompleted(Ticket ticket) {
        // No-op: 同 onTranslationCompleted，由 WorkflowTaskBridge 自动处理。
        log.debug("[FlowableOrchestrator] onReplyCompleted for ticket #{} — " +
                "no-op, workflow auto-bridges via TaskCompletedEvent", ticket.getId());
    }

    @Override
    public void onAuditCompleted(Ticket ticket, AuditResult result, String auditRemark,
                                  Long replyId, Long auditorId) {
        // 审核是人工完成（非 Agent 任务），需要手动 signal ReceiveTask
        String businessKey = String.valueOf(ticket.getId());
        String processInstanceId = workflowService.getProcessInstanceId(businessKey);

        if (processInstanceId == null) {
            log.warn("[FlowableOrchestrator] No active process for ticket #{}, skipping signal", ticket.getId());
            return;
        }

        Map<String, Object> vars = new HashMap<>();
        vars.put("auditResult", result.name());
        vars.put("auditRemark", auditRemark);
        vars.put("replyId", replyId);
        vars.put("auditorId", auditorId);

        try {
            workflowService.signalReceiveTask(processInstanceId, "audit_create_wait", vars);
            log.info("[FlowableOrchestrator] Signaled audit_create_wait for ticket #{}, result={}", ticket.getId(), result);
        } catch (Exception e) {
            log.warn("[FlowableOrchestrator] audit_create_wait signal failed for ticket #{}: {}",
                    ticket.getId(), e.getMessage());
        }
    }
}
