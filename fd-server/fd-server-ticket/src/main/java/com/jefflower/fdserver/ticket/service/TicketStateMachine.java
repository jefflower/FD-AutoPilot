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
 * 工单状态机 —— 声明式状态转换规则
 *
 * <p>集中管理所有合法的状态转换，替代 TicketService 中分散的 if/else 判断。</p>
 *
 * <h3>主流程</h3>
 * <pre>
 * PENDING_TRANS → TRANSLATING → PENDING_REPLY → REPLYING → PENDING_AUDIT → AUDITING → APPROVED → COMPLETED
 * </pre>
 *
 * <h3>分支流程</h3>
 * <ul>
 *   <li>审核驳回（重新回复）：PENDING_AUDIT/AUDITING → PENDING_REPLY</li>
 *   <li>审核驳回（重新翻译）：PENDING_AUDIT/AUDITING → PENDING_TRANS</li>
 *   <li>审核通过 + 自动推送：PENDING_AUDIT/AUDITING → COMPLETED</li>
 *   <li>跳过回复：任意状态 → COMPLETED</li>
 *   <li>手动触发翻译：任意状态 → TRANSLATING</li>
 *   <li>手动触发回复：任意状态 → REPLYING</li>
 *   <li>同步重触发：COMPLETED/APPROVED → PENDING_TRANS</li>
 *   <li>处理超时回退：TRANSLATING → PENDING_TRANS, REPLYING → PENDING_REPLY, AUDITING → PENDING_AUDIT</li>
 * </ul>
 */
@Slf4j
@Component
public class TicketStateMachine {

    /**
     * 标准流程的合法转换表（严格的状态前进路径）
     */
    private static final Map<TicketStatus, Set<TicketStatus>> STANDARD_TRANSITIONS = Map.ofEntries(
            // 主流程前进
            Map.entry(TicketStatus.PENDING_TRANS, Set.of(
                    TicketStatus.TRANSLATING,    // 任务被领取
                    TicketStatus.PENDING_REPLY   // 翻译上报（幂等：跳过 TRANSLATING 直接到 PENDING_REPLY）
            )),
            Map.entry(TicketStatus.TRANSLATING, Set.of(
                    TicketStatus.PENDING_REPLY   // 翻译完成
            )),
            Map.entry(TicketStatus.PENDING_REPLY, Set.of(
                    TicketStatus.REPLYING,       // 任务被领取
                    TicketStatus.PENDING_AUDIT   // 回复上报（幂等：跳过 REPLYING 直接到 PENDING_AUDIT）
            )),
            Map.entry(TicketStatus.REPLYING, Set.of(
                    TicketStatus.PENDING_AUDIT   // 回复完成
            )),
            Map.entry(TicketStatus.PENDING_AUDIT, Set.of(
                    TicketStatus.AUDITING,       // 审核任务被领取
                    TicketStatus.APPROVED,       // 审核通过（手动推送模式）
                    TicketStatus.COMPLETED,      // 审核通过（自动推送模式）
                    TicketStatus.PENDING_REPLY,  // 审核驳回 → 重新回复
                    TicketStatus.PENDING_TRANS   // 审核驳回 → 重新翻译
            )),
            Map.entry(TicketStatus.AUDITING, Set.of(
                    TicketStatus.APPROVED,       // 审核通过（手动推送模式）
                    TicketStatus.COMPLETED,      // 审核通过（自动推送模式）
                    TicketStatus.PENDING_REPLY,  // 审核驳回 → 重新回复
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
     * 强制转换集合 —— 不受标准转换表约束，用于手动触发和系统操作。
     *
     * <p>包含以下场景：</p>
     * <ul>
     *   <li>手动触发翻译：任意状态 → TRANSLATING</li>
     *   <li>手动触发回复：任意状态 → REPLYING</li>
     *   <li>跳过回复：任意状态 → COMPLETED</li>
     *   <li>处理超时回退：TRANSLATING → PENDING_TRANS, REPLYING → PENDING_REPLY, AUDITING → PENDING_AUDIT</li>
     * </ul>
     */
    private static final Map<TicketStatus, Set<TicketStatus>> RESET_TRANSITIONS = Map.of(
            TicketStatus.TRANSLATING, Set.of(TicketStatus.PENDING_TRANS),
            TicketStatus.REPLYING, Set.of(TicketStatus.PENDING_REPLY),
            TicketStatus.AUDITING, Set.of(TicketStatus.PENDING_AUDIT)
    );

    /**
     * 验证标准流程的状态转换是否合法。
     *
     * @param from 当前状态
     * @param to   目标状态
     * @return true 如果转换合法
     */
    public boolean isValidTransition(TicketStatus from, TicketStatus to) {
        Set<TicketStatus> allowed = STANDARD_TRANSITIONS.get(from);
        return allowed != null && allowed.contains(to);
    }

    /**
     * 验证标准流程的状态转换，不合法则抛出异常。
     *
     * @param from 当前状态
     * @param to   目标状态
     * @throws BusinessException 如果转换不合法
     */
    public void validateTransition(TicketStatus from, TicketStatus to) {
        if (!isValidTransition(from, to)) {
            throw new BusinessException(ErrorCode.INVALID_STATUS_TRANSITION,
                    String.format("非法状态转换: %s → %s", from, to));
        }
    }

    /**
     * 执行标准流程的状态转换（验证 + 更新状态 + 时间戳）。
     *
     * @param ticket       工单实体
     * @param targetStatus 目标状态
     * @throws BusinessException 如果转换不合法
     */
    public void transition(Ticket ticket, TicketStatus targetStatus) {
        TicketStatus from = ticket.getStatus();
        validateTransition(from, targetStatus);
        applyStatus(ticket, targetStatus, from);
    }

    /**
     * 强制转换 —— 用于手动触发翻译/回复和跳过回复等不受标准流程约束的操作。
     *
     * <p>不做转换合法性校验，直接更新状态。调用方需自行确保业务逻辑正确。</p>
     *
     * @param ticket       工单实体
     * @param targetStatus 目标状态
     */
    public void forceTransition(Ticket ticket, TicketStatus targetStatus) {
        TicketStatus from = ticket.getStatus();
        applyStatus(ticket, targetStatus, from);
    }

    /**
     * 检查当前状态是否属于指定的幂等接受集合。
     *
     * <p>用于幂等性检查：如果当前状态不在接受集合内，说明工单已推进到更后面的阶段，
     * 这是重复消息，应跳过处理。</p>
     *
     * @param currentStatus  当前状态
     * @param acceptedStates 可接受的状态集合
     * @return true 如果当前状态在可接受集合中
     */
    public boolean isInAcceptedStates(TicketStatus currentStatus, Set<TicketStatus> acceptedStates) {
        return acceptedStates.contains(currentStatus);
    }

    /**
     * 验证处理超时回退是否合法。
     *
     * @param from 当前状态
     * @param to   目标状态（回退后的等待状态）
     * @return true 如果回退合法
     */
    public boolean isValidResetTransition(TicketStatus from, TicketStatus to) {
        Set<TicketStatus> allowed = RESET_TRANSITIONS.get(from);
        return allowed != null && allowed.contains(to);
    }

    // ========== 幂等接受状态集合（供 TicketService 使用） ==========

    /**
     * 翻译上报可接受的状态集合
     * TRANSLATING（正常流程）/ PENDING_TRANS（幂等，尚未开始翻译）/ PENDING_REPLY（幂等，已完成翻译）
     */
    public static final Set<TicketStatus> TRANSLATION_ACCEPTED_STATES = Set.of(
            TicketStatus.TRANSLATING,
            TicketStatus.PENDING_TRANS,
            TicketStatus.PENDING_REPLY
    );

    /**
     * 回复上报可接受的状态集合
     * REPLYING（正常流程）/ PENDING_REPLY（幂等，尚未开始回复）
     */
    public static final Set<TicketStatus> REPLY_ACCEPTED_STATES = Set.of(
            TicketStatus.REPLYING,
            TicketStatus.PENDING_REPLY
    );

    /**
     * 审核上报可接受的状态集合
     * AUDITING（正常流程）/ PENDING_AUDIT（幂等，尚未开始审核）
     */
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
