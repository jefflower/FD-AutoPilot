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
 * 工单状态机 —— 声明式状态转换规则（完整 8 状态 + PROCESSING 兼容）
 *
 * <h3>主流程</h3>
 * <pre>
 * PENDING_TRANS → TRANSLATING → PENDING_REPLY → REPLYING → PENDING_AUDIT → AUDITING → APPROVED → COMPLETED
 * </pre>
 *
 * <h3>兼容流程（PROCESSING 统一态）</h3>
 * <pre>
 * PENDING_TRANS → PROCESSING → PENDING_AUDIT → APPROVED → COMPLETED
 * </pre>
 *
 * <h3>分支流程</h3>
 * <ul>
 *   <li>审核驳回（重新回复）：PENDING_AUDIT/AUDITING → REPLYING/PROCESSING</li>
 *   <li>审核驳回（重新翻译）：PENDING_AUDIT/AUDITING → PENDING_TRANS</li>
 *   <li>审核通过 + 自动推送：PENDING_AUDIT/AUDITING → COMPLETED</li>
 *   <li>审核跳过（无需处理）：PENDING_AUDIT/AUDITING → SKIPPED</li>
 *   <li>推送页跳过（无需处理）：APPROVED → SKIPPED</li>
 *   <li>同步重触发：COMPLETED/APPROVED/SKIPPED → PENDING_TRANS</li>
 *   <li>处理超时回退：PROCESSING/TRANSLATING/PENDING_REPLY/REPLYING → PENDING_TRANS</li>
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
                    TicketStatus.TRANSLATING,        // 翻译 Agent 开始执行
                    TicketStatus.PROCESSING,         // 兼容：n8n 并行网关直接进入处理中
                    TicketStatus.COMPLETED           // AI 判定已解决，直接完结
            )),
            Map.entry(TicketStatus.TRANSLATING, Set.of(
                    TicketStatus.PENDING_REPLY,      // 翻译完成，等待回复
                    TicketStatus.PENDING_AUDIT,      // 翻译完成，直接进入审核（跳过回复）
                    TicketStatus.MANUAL_REQUIRED     // 分类为商务合作/其他时标记人工处理
            )),
            Map.entry(TicketStatus.PENDING_REPLY, Set.of(
                    TicketStatus.REPLYING            // 回复 Agent 开始执行
            )),
            Map.entry(TicketStatus.REPLYING, Set.of(
                    TicketStatus.PENDING_AUDIT       // 回复完成，进入审核
            )),
            Map.entry(TicketStatus.PROCESSING, Set.of(
                    TicketStatus.PENDING_AUDIT,      // 兼容：翻译+回复均完成，进入审核
                    TicketStatus.COMPLETED,          // 翻译保存后判定已解决，直接完结
                    TicketStatus.MANUAL_REQUIRED     // 分类为商务合作/物流查询/其他时标记人工处理
            )),
            Map.entry(TicketStatus.PENDING_AUDIT, Set.of(
                    TicketStatus.AUDITING,           // 审核人开始审核
                    TicketStatus.APPROVED,           // 审核通过（手动推送模式）
                    TicketStatus.COMPLETED,          // 审核通过（自动推送模式）
                    TicketStatus.SKIPPED,            // 审核跳过（无需处理）
                    TicketStatus.REPLYING,           // 审核驳回 → 重新回复
                    TicketStatus.PROCESSING,         // 兼容：审核驳回 → 重新回复
                    TicketStatus.PENDING_TRANS       // 审核驳回 → 重新翻译
            )),
            Map.entry(TicketStatus.AUDITING, Set.of(
                    TicketStatus.APPROVED,           // 审核通过（手动推送模式）
                    TicketStatus.COMPLETED,          // 审核通过（自动推送模式）
                    TicketStatus.SKIPPED,            // 审核跳过（无需处理）
                    TicketStatus.REPLYING,           // 审核驳回 → 重新回复
                    TicketStatus.PROCESSING,         // 兼容：审核驳回 → 重新回复
                    TicketStatus.PENDING_TRANS       // 审核驳回 → 重新翻译
            )),
            Map.entry(TicketStatus.APPROVED, Set.of(
                    TicketStatus.COMPLETED,          // 手动推送到 Freshdesk
                    TicketStatus.SKIPPED,            // 推送页跳过（无需处理）
                    TicketStatus.PENDING_TRANS       // 同步发现内容变化，重新触发
            )),
            Map.entry(TicketStatus.MANUAL_REQUIRED, Set.of(
                    TicketStatus.PENDING_REPLY,      // 人工介入后继续处理
                    TicketStatus.REPLYING,           // 人工提交 AI 回复（跳过翻译，直接回复）
                    TicketStatus.PENDING_AUDIT,      // 人工回复后直接进入审核
                    TicketStatus.COMPLETED           // 人工直接完结
            )),
            Map.entry(TicketStatus.COMPLETED, Set.of(
                    TicketStatus.PENDING_TRANS       // 同步发现内容变化，重新触发
            )),
            Map.entry(TicketStatus.SKIPPED, Set.of(
                    TicketStatus.PENDING_TRANS       // 数据同步重激活（与 COMPLETED 同逻辑）
            ))
    );

    /**
     * 超时/异常回退转换
     */
    private static final Map<TicketStatus, Set<TicketStatus>> RESET_TRANSITIONS = Map.of(
            TicketStatus.PROCESSING, Set.of(TicketStatus.PENDING_TRANS),
            TicketStatus.TRANSLATING, Set.of(TicketStatus.PENDING_TRANS),
            TicketStatus.PENDING_REPLY, Set.of(TicketStatus.PENDING_TRANS),
            TicketStatus.REPLYING, Set.of(TicketStatus.PENDING_TRANS),
            TicketStatus.MANUAL_REQUIRED, Set.of(TicketStatus.PENDING_TRANS)
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

    /** 翻译上报可接受：PENDING_TRANS / PROCESSING / TRANSLATING */
    public static final Set<TicketStatus> TRANSLATION_ACCEPTED_STATES = Set.of(
            TicketStatus.PENDING_TRANS,
            TicketStatus.PROCESSING,
            TicketStatus.TRANSLATING
    );

    /** 回复上报可接受：PROCESSING / PENDING_REPLY / REPLYING */
    public static final Set<TicketStatus> REPLY_ACCEPTED_STATES = Set.of(
            TicketStatus.PROCESSING,
            TicketStatus.PENDING_REPLY,
            TicketStatus.REPLYING
    );

    /** 并行网关回复上报可接受（放宽）：PENDING_TRANS / PROCESSING / PENDING_REPLY */
    public static final Set<TicketStatus> WORKFLOW_REPLY_ACCEPTED_STATES = Set.of(
            TicketStatus.PENDING_TRANS,
            TicketStatus.PROCESSING,
            TicketStatus.PENDING_REPLY
    );

    /** 审核上报可接受：PENDING_AUDIT / AUDITING */
    public static final Set<TicketStatus> AUDIT_ACCEPTED_STATES = Set.of(
            TicketStatus.PENDING_AUDIT,
            TicketStatus.AUDITING
    );

    // ========== 内部方法 ==========

    private void applyStatus(Ticket ticket, TicketStatus targetStatus, TicketStatus from) {
        ticket.setStatus(targetStatus);
        ticket.setUpdatedAt(LocalDateTime.now());
        log.debug("[StateMachine] 工单#{} 状态转换: {} → {}", ticket.getId(), from, targetStatus);
    }
}
