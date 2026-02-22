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
 * 数据保存在 TicketService 中完成，此处仅负责唤醒 BPMN ReceiveTask。
 * 状态转换和后续任务创建由 BPMN 流程中的 BusinessCallbackDelegate 触发回调完成。
 */
@Slf4j
@RequiredArgsConstructor
public class FlowableTicketOrchestrator implements TicketWorkflowOrchestrator {

    private final WorkflowService workflowService;

    @Override
    public void onTranslationCompleted(Ticket ticket) {
        String businessKey = String.valueOf(ticket.getId());
        String processInstanceId = workflowService.getProcessInstanceId(businessKey);

        if (processInstanceId == null) {
            log.warn("[FlowableOrchestrator] No active process for ticket #{}, skipping signal", ticket.getId());
            return;
        }

        try {
            workflowService.signalReceiveTask(processInstanceId, "translate_wait", Map.of());
            log.info("[FlowableOrchestrator] Signaled translate_wait for ticket #{}", ticket.getId());
        } catch (Exception e) {
            log.warn("[FlowableOrchestrator] translate_wait signal failed for ticket #{}: {}",
                    ticket.getId(), e.getMessage());
        }
    }

    @Override
    public void onReplyCompleted(Ticket ticket) {
        String businessKey = String.valueOf(ticket.getId());
        String processInstanceId = workflowService.getProcessInstanceId(businessKey);

        if (processInstanceId == null) {
            log.warn("[FlowableOrchestrator] No active process for ticket #{}, skipping signal", ticket.getId());
            return;
        }

        try {
            workflowService.signalReceiveTask(processInstanceId, "reply_wait", Map.of());
            log.info("[FlowableOrchestrator] Signaled reply_wait for ticket #{}", ticket.getId());
        } catch (Exception e) {
            log.warn("[FlowableOrchestrator] reply_wait signal failed for ticket #{}: {}",
                    ticket.getId(), e.getMessage());
        }
    }

    @Override
    public void onAuditCompleted(Ticket ticket, AuditResult result, String auditRemark,
                                  Long replyId, Long auditorId) {
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
            workflowService.signalReceiveTask(processInstanceId, "audit_wait", vars);
            log.info("[FlowableOrchestrator] Signaled audit_wait for ticket #{}, result={}", ticket.getId(), result);
        } catch (Exception e) {
            log.warn("[FlowableOrchestrator] audit_wait signal failed for ticket #{}: {}",
                    ticket.getId(), e.getMessage());
        }
    }
}
