package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.Set;

/**
 * 工单状态机 —— 声明式状态转换规则（简化版，适配并行网关）
 *
 * <h3>主流程</h3>
 * <pre>
 * PENDING_TRANS → PROCESSING → PENDING_AUDIT → AUDITING → APPROVED → COMPLETED
 * </pre>
 *
 * <p>PROCESSING 统一代表"翻译和/或回复正在执行中"，不再区分 TRANSLATING/PENDING_REPLY/REPLYING。
 * 并行网关下的真实进度由 BPMN 流程实例的活跃节点决定，ticket.status 只反映粗粒度阶段。</p>
 *
 * <h3>分支流程</h3>
 * <ul>
 *   <li>审核驳回（重新回复）：PENDING_AUDIT/AUDITING → PROCESSING</li>
 *   <li>审核驳回（重新翻译）：PENDING_AUDIT/AUDITING → PENDING_TRANS</li>
 *   <li>审核通过 + 自动推送：PENDING_AUDIT/AUDITING → COMPLETED</li>
 *   <li>同步重触发：COMPLETED/APPROVED → PENDING_TRANS</li>
 *   <li>处理超时回退：PROCESSING → PENDING_TRANS, AUDITING → PENDING_AUDIT</li>
 * </ul>
 */
@Slf4j
@Component
public class TicketStateMachine {

    /**
     * 标准流程的合法转换表
     */
    private static final Map<TicketStatus, Set<TicketStatus>> STANDARD_TRANSITIONS = Map.ofEntries(
            Map.entry(TicketStatus.PENDING_TRANS, Set.of(
                    TicketStatus.PROCESSING      // 翻译/回复 Agent 开始执行
            )),
            Map.entry(TicketStatus.PROCESSING, Set.of(
                    TicketStatus.PENDING_AUDIT   // 翻译+回复均完成，进入审核
            )),
            Map.entry(TicketStatus.PENDING_AUDIT, Set.of(
                    TicketStatus.AUDITING,       // 审核任务被领取
                    TicketStatus.APPROVED,       // 审核通过（手动推送模式）
                    TicketStatus.COMPLETED,      // 审核通过（自动推送模式）
                    TicketStatus.PROCESSING,     // 审核驳回 → 重新回复
                    TicketStatus.PENDING_TRANS   // 审核驳回 → 重新翻译
            )),
            Map.entry(TicketStatus.AUDITING, Set.of(
                    TicketStatus.APPROVED,       // 审核通过（手动推送模式）
                    TicketStatus.COMPLETED,      // 审核通过（自动推送模式）
                    TicketStatus.PROCESSING,     // 审核驳回 → 重新回复
                    TicketStatus.PENDING_TRANS   // 审核驳回 → 重新翻译
            )),
            Map.entry(TicketStatus.APPROVED, Set.of(
                    TicketStatus.COMPLETED,      // 手动推送到 Freshdesk
                    TicketStatus.PENDING_TRANS   // 同步发现内容变化，重新触发
            )),
            Map.entry(TicketStatus.COMPLETED, Set.of(
                    TicketStatus.PENDING_TRANS   // 同步发现内容变化，重新触发
            ))
    );

    /**
     * 超时/异常回退转换
     */
    private static final Map<TicketStatus, Set<TicketStatus>> RESET_TRANSITIONS = Map.of(
            TicketStatus.PROCESSING, Set.of(TicketStatus.PENDING_TRANS),
            TicketStatus.AUDITING, Set.of(TicketStatus.PENDING_AUDIT)
    );

    public boolean isValidTransition(TicketStatus from, TicketStatus to) {
        Set<TicketStatus> allowed = STANDARD_TRANSITIONS.get(from);
        return allowed != null && allowed.contains(to);
    }

    public void validateTransition(TicketStatus from, TicketStatus to) {
        if (!isValidTransition(from, to)) {
            throw new BusinessException(ErrorCode.INVALID_STATUS_TRANSITION,
                    String.format("非法状态转换: %s → %s", from, to));
        }
    }

    public void transition(Ticket ticket, TicketStatus targetStatus) {
        TicketStatus from = ticket.getStatus();
        validateTransition(from, targetStatus);
        applyStatus(ticket, targetStatus, from);
    }

    public void forceTransition(Ticket ticket, TicketStatus targetStatus) {
        TicketStatus from = ticket.getStatus();
        applyStatus(ticket, targetStatus, from);
    }

    public boolean isInAcceptedStates(TicketStatus currentStatus, Set<TicketStatus> acceptedStates) {
        return acceptedStates.contains(currentStatus);
    }

    public boolean isValidResetTransition(TicketStatus from, TicketStatus to) {
        Set<TicketStatus> allowed = RESET_TRANSITIONS.get(from);
        return allowed != null && allowed.contains(to);
    }

    // ========== 幂等接受状态集合 ==========

    /** 翻译上报可接受：PROCESSING / PENDING_TRANS */
    public static final Set<TicketStatus> TRANSLATION_ACCEPTED_STATES = Set.of(
            TicketStatus.PROCESSING,
            TicketStatus.PENDING_TRANS
    );

    /** 回复上报可接受：PROCESSING */
    public static final Set<TicketStatus> REPLY_ACCEPTED_STATES = Set.of(
            TicketStatus.PROCESSING
    );

    /** 并行网关回复上报可接受（放宽）：PENDING_TRANS / PROCESSING */
    public static final Set<TicketStatus> WORKFLOW_REPLY_ACCEPTED_STATES = Set.of(
            TicketStatus.PENDING_TRANS,
            TicketStatus.PROCESSING
    );

    /** 审核上报可接受：AUDITING / PENDING_AUDIT */
    public static final Set<TicketStatus> AUDIT_ACCEPTED_STATES = Set.of(
            TicketStatus.AUDITING,
            TicketStatus.PENDING_AUDIT
    );

    // ========== 内部方法 ==========

    private void applyStatus(Ticket ticket, TicketStatus targetStatus, TicketStatus from) {
        ticket.setStatus(targetStatus);
        ticket.setUpdatedAt(LocalDateTime.now());
        log.debug("[StateMachine] 工单#{} 状态转换: {} → {}", ticket.getId(), from, targetStatus);
    }
}
