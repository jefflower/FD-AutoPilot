package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.enums.AuditResult;

/**
 * 工单工作流编排接口 — 委托 Flowable BPMN 引擎处理流程推进。
 * <p>
 * 实现类 {@link FlowableTicketOrchestrator} 通过 BPMN 信号（signal ReceiveTask）驱动流程。
 */
public interface TicketWorkflowOrchestrator {

    /**
     * 检查工单是否有活跃的工作流流程实例
     */
    boolean hasActiveProcess(Ticket ticket);

    /**
     * 新工单进入系统后的编排逻辑（启动工作流/创建翻译任务）
     */
    void onNewTicket(Ticket ticket);

    /**
     * 翻译完成后的编排逻辑
     */
    void onTranslationCompleted(Ticket ticket);

    /**
     * 回复完成后的编排逻辑
     */
    void onReplyCompleted(Ticket ticket);

    /**
     * 审核完成后的编排逻辑
     */
    void onAuditCompleted(Ticket ticket, AuditResult result, String auditRemark,
                          Long replyId, Long auditorId);
}
