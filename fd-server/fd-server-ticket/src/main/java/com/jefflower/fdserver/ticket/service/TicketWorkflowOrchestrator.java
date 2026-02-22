package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.enums.AuditResult;

/**
 * 工单工作流编排接口 — 双轨运行策略。
 * <p>
 * Legacy 实现使用硬编码流程（状态转换 + TaskInstance 创建），
 * Flowable 实现委托 BPMN 引擎（signal ReceiveTask）。
 */
public interface TicketWorkflowOrchestrator {

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
