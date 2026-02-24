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

    /**
     * 是否为 Flowable BPMN 工作流模式。
     * <p>
     * Flowable 模式下并行网关允许翻译和回复同时执行，
     * 工单状态管理由 BPMN 回调统一控制，TicketService 的幂等检查需要放宽。
     * <p>
     * Legacy 模式（默认）返回 false。
     */
    default boolean isFlowableMode() {
        return false;
    }
}
