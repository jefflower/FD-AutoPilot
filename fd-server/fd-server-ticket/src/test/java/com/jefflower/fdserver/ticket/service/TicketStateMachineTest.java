package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

@DisplayName("TicketStateMachine")
class TicketStateMachineTest {

    private final TicketStateMachine stateMachine = new TicketStateMachine();
    private Ticket ticket;

    @BeforeEach
    void setUp() {
        ticket = new Ticket();
        ticket.setId(1L);
        ticket.setExternalId("FD-1001");
    }

    // =========================================================================
    // 主流程合法转换验证（简化后：5 状态模型）
    // =========================================================================

    @Nested
    @DisplayName("标准流程 - 合法转换")
    class ValidTransitions {

        static Stream<Arguments> validTransitionPairs() {
            return Stream.of(
                    // 主流程前进
                    Arguments.of(TicketStatus.PENDING_TRANS, TicketStatus.PROCESSING, "待翻译 → 处理中"),
                    Arguments.of(TicketStatus.PROCESSING, TicketStatus.PENDING_AUDIT, "处理中 → 待审核"),

                    // 审核通过路径
                    Arguments.of(TicketStatus.PENDING_AUDIT, TicketStatus.APPROVED, "待审核 → 已审核（手动推送）"),
                    Arguments.of(TicketStatus.PENDING_AUDIT, TicketStatus.COMPLETED, "待审核 → 已完成（自动推送）"),

                    // 审核驳回 → 重新回复
                    Arguments.of(TicketStatus.PENDING_AUDIT, TicketStatus.PROCESSING, "待审核 → 处理中（驳回重新回复）"),

                    // 审核驳回 → 重新翻译
                    Arguments.of(TicketStatus.PENDING_AUDIT, TicketStatus.PENDING_TRANS, "待审核 → 待翻译（驳回重新翻译）"),

                    // 推送
                    Arguments.of(TicketStatus.APPROVED, TicketStatus.COMPLETED, "已审核 → 已完成（手动推送）"),

                    // 同步重触发
                    Arguments.of(TicketStatus.APPROVED, TicketStatus.PENDING_TRANS, "已审核 → 待翻译（同步重触发）"),
                    Arguments.of(TicketStatus.COMPLETED, TicketStatus.PENDING_TRANS, "已完成 → 待翻译（同步重触发）"),

                    // AI 判定已解决 → 直接完结
                    Arguments.of(TicketStatus.PENDING_TRANS, TicketStatus.COMPLETED, "待翻译 → 已完成（AI 判定已解决）"),
                    Arguments.of(TicketStatus.PROCESSING, TicketStatus.COMPLETED, "处理中 → 已完成（AI 判定已解决）")
            );
        }

        @ParameterizedTest(name = "{2}: {0} → {1}")
        @MethodSource("validTransitionPairs")
        @DisplayName("合法转换应通过验证")
        void validTransition_passes(TicketStatus from, TicketStatus to, String description) {
            assertTrue(stateMachine.isValidTransition(from, to),
                    "期望合法: " + description);
        }

        @ParameterizedTest(name = "{2}: {0} → {1}")
        @MethodSource("validTransitionPairs")
        @DisplayName("合法转换 transition() 应成功执行")
        void validTransition_executes(TicketStatus from, TicketStatus to, String description) {
            ticket.setStatus(from);

            assertDoesNotThrow(() -> stateMachine.transition(ticket, to));
            assertEquals(to, ticket.getStatus());
            assertNotNull(ticket.getUpdatedAt());
        }
    }

    // =========================================================================
    // 非法转换验证
    // =========================================================================

    @Nested
    @DisplayName("标准流程 - 非法转换")
    class InvalidTransitions {

        static Stream<Arguments> invalidTransitionPairs() {
            return Stream.of(
                    // 跳过阶段
                    Arguments.of(TicketStatus.PENDING_TRANS, TicketStatus.PENDING_AUDIT, "不能跳过处理阶段"),
                    Arguments.of(TicketStatus.PROCESSING, TicketStatus.APPROVED, "处理中不能直接到已审核"),

                    // 逆流
                    Arguments.of(TicketStatus.COMPLETED, TicketStatus.APPROVED, "不能从已完成回到已审核"),
                    Arguments.of(TicketStatus.COMPLETED, TicketStatus.PROCESSING, "不能从已完成回到处理中"),

                    // 自身转换
                    Arguments.of(TicketStatus.PROCESSING, TicketStatus.PROCESSING, "不能自身转换"),
                    Arguments.of(TicketStatus.PENDING_TRANS, TicketStatus.PENDING_TRANS, "不能自身转换")
            );
        }

        @ParameterizedTest(name = "{2}: {0} → {1}")
        @MethodSource("invalidTransitionPairs")
        @DisplayName("非法转换应被拒绝")
        void invalidTransition_rejected(TicketStatus from, TicketStatus to, String description) {
            assertFalse(stateMachine.isValidTransition(from, to),
                    "期望非法: " + description);
        }

        @ParameterizedTest(name = "{2}: {0} → {1}")
        @MethodSource("invalidTransitionPairs")
        @DisplayName("非法转换 transition() 应抛出 BusinessException")
        void invalidTransition_throwsException(TicketStatus from, TicketStatus to, String description) {
            ticket.setStatus(from);

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> stateMachine.transition(ticket, to));
            assertTrue(ex.getMessage().contains(from.name()));
            assertTrue(ex.getMessage().contains(to.name()));
        }
    }

    // =========================================================================
    // 强制转换验证
    // =========================================================================

    @Nested
    @DisplayName("强制转换 - forceTransition")
    class ForceTransitions {

        @Test
        @DisplayName("手动触发处理：任意状态 → PROCESSING")
        void forceTransition_anyToProcessing() {
            for (TicketStatus status : TicketStatus.values()) {
                ticket.setStatus(status);
                assertDoesNotThrow(() -> stateMachine.forceTransition(ticket, TicketStatus.PROCESSING));
                assertEquals(TicketStatus.PROCESSING, ticket.getStatus());
            }
        }

        @Test
        @DisplayName("跳过回复：任意状态 → COMPLETED")
        void forceTransition_anyToCompleted() {
            for (TicketStatus status : TicketStatus.values()) {
                ticket.setStatus(status);
                assertDoesNotThrow(() -> stateMachine.forceTransition(ticket, TicketStatus.COMPLETED));
                assertEquals(TicketStatus.COMPLETED, ticket.getStatus());
            }
        }

        @Test
        @DisplayName("强制转换会更新 updatedAt")
        void forceTransition_updatesTimestamp() {
            ticket.setStatus(TicketStatus.PENDING_TRANS);
            ticket.setUpdatedAt(null);

            stateMachine.forceTransition(ticket, TicketStatus.PROCESSING);

            assertNotNull(ticket.getUpdatedAt());
        }
    }

    // =========================================================================
    // 幂等状态检查
    // =========================================================================

    @Nested
    @DisplayName("幂等性检查 - isInAcceptedStates")
    class IdempotencyCheck {

        @Test
        @DisplayName("翻译幂等：PROCESSING/PENDING_TRANS 在接受范围内")
        void translationAccepted() {
            assertTrue(stateMachine.isInAcceptedStates(TicketStatus.PROCESSING, TicketStateMachine.TRANSLATION_ACCEPTED_STATES));
            assertTrue(stateMachine.isInAcceptedStates(TicketStatus.PENDING_TRANS, TicketStateMachine.TRANSLATION_ACCEPTED_STATES));
        }

        @Test
        @DisplayName("翻译幂等：PENDING_AUDIT/APPROVED/COMPLETED 不在接受范围内")
        void translationRejected() {
            assertFalse(stateMachine.isInAcceptedStates(TicketStatus.PENDING_AUDIT, TicketStateMachine.TRANSLATION_ACCEPTED_STATES));
            assertFalse(stateMachine.isInAcceptedStates(TicketStatus.APPROVED, TicketStateMachine.TRANSLATION_ACCEPTED_STATES));
            assertFalse(stateMachine.isInAcceptedStates(TicketStatus.COMPLETED, TicketStateMachine.TRANSLATION_ACCEPTED_STATES));
        }

        @Test
        @DisplayName("回复幂等：PROCESSING 在接受范围内")
        void replyAccepted() {
            assertTrue(stateMachine.isInAcceptedStates(TicketStatus.PROCESSING, TicketStateMachine.REPLY_ACCEPTED_STATES));
        }

        @Test
        @DisplayName("回复幂等：PENDING_TRANS/PENDING_AUDIT/APPROVED/COMPLETED 不在接受范围内")
        void replyRejected() {
            assertFalse(stateMachine.isInAcceptedStates(TicketStatus.PENDING_TRANS, TicketStateMachine.REPLY_ACCEPTED_STATES));
            assertFalse(stateMachine.isInAcceptedStates(TicketStatus.PENDING_AUDIT, TicketStateMachine.REPLY_ACCEPTED_STATES));
            assertFalse(stateMachine.isInAcceptedStates(TicketStatus.APPROVED, TicketStateMachine.REPLY_ACCEPTED_STATES));
            assertFalse(stateMachine.isInAcceptedStates(TicketStatus.COMPLETED, TicketStateMachine.REPLY_ACCEPTED_STATES));
        }

        @Test
        @DisplayName("审核幂等：PENDING_AUDIT 在接受范围内")
        void auditAccepted() {
            assertTrue(stateMachine.isInAcceptedStates(TicketStatus.PENDING_AUDIT, TicketStateMachine.AUDIT_ACCEPTED_STATES));
        }

        @Test
        @DisplayName("审核幂等：PROCESSING/APPROVED/COMPLETED 不在接受范围内")
        void auditRejected() {
            assertFalse(stateMachine.isInAcceptedStates(TicketStatus.PROCESSING, TicketStateMachine.AUDIT_ACCEPTED_STATES));
            assertFalse(stateMachine.isInAcceptedStates(TicketStatus.APPROVED, TicketStateMachine.AUDIT_ACCEPTED_STATES));
            assertFalse(stateMachine.isInAcceptedStates(TicketStatus.COMPLETED, TicketStateMachine.AUDIT_ACCEPTED_STATES));
        }
    }

    // =========================================================================
    // 超时回退验证
    // =========================================================================

    @Nested
    @DisplayName("超时回退 - isValidResetTransition")
    class ResetTransitions {

        @Test
        @DisplayName("PROCESSING → PENDING_TRANS 合法")
        void processingReset() {
            assertTrue(stateMachine.isValidResetTransition(TicketStatus.PROCESSING, TicketStatus.PENDING_TRANS));
        }

        @Test
        @DisplayName("非处理中状态不能回退")
        void nonProcessingStates_cannotReset() {
            assertFalse(stateMachine.isValidResetTransition(TicketStatus.PENDING_TRANS, TicketStatus.PENDING_TRANS));
            assertFalse(stateMachine.isValidResetTransition(TicketStatus.APPROVED, TicketStatus.PENDING_TRANS));
            assertFalse(stateMachine.isValidResetTransition(TicketStatus.COMPLETED, TicketStatus.PENDING_TRANS));
        }

        @Test
        @DisplayName("回退方向必须正确")
        void resetDirection_mustBeCorrect() {
            assertFalse(stateMachine.isValidResetTransition(TicketStatus.PROCESSING, TicketStatus.PENDING_AUDIT));
        }
    }

    // =========================================================================
    // validateTransition 异常测试
    // =========================================================================

    @Nested
    @DisplayName("validateTransition 异常行为")
    class ValidateTransitionExceptions {

        @Test
        @DisplayName("合法转换不抛异常")
        void validTransition_noException() {
            assertDoesNotThrow(() ->
                    stateMachine.validateTransition(TicketStatus.PENDING_TRANS, TicketStatus.PROCESSING));
        }

        @Test
        @DisplayName("非法转换抛 BusinessException，包含状态信息")
        void invalidTransition_throwsWithDetail() {
            BusinessException ex = assertThrows(BusinessException.class, () ->
                    stateMachine.validateTransition(TicketStatus.PENDING_TRANS, TicketStatus.PENDING_AUDIT));

            assertTrue(ex.getMessage().contains("PENDING_TRANS"));
            assertTrue(ex.getMessage().contains("PENDING_AUDIT"));
        }
    }

    // =========================================================================
    // 转换规则完整性
    // =========================================================================

    @Nested
    @DisplayName("转换规则完整性")
    class TransitionCompleteness {

        @Test
        @DisplayName("所有状态在标准转换表中都有出边")
        void allStatesHaveTransitions() {
            for (TicketStatus status : TicketStatus.values()) {
                boolean hasAnyValidTarget = false;
                for (TicketStatus target : TicketStatus.values()) {
                    if (stateMachine.isValidTransition(status, target)) {
                        hasAnyValidTarget = true;
                        break;
                    }
                }
                assertTrue(hasAnyValidTarget,
                        "状态 " + status + " 在标准转换表中没有任何合法目标状态");
            }
        }

        @Test
        @DisplayName("COMPLETED 和 APPROVED 只能转换到 PENDING_TRANS（同步重触发）")
        void terminalStates_onlyResyncable() {
            // COMPLETED 只能转到 PENDING_TRANS
            assertTrue(stateMachine.isValidTransition(TicketStatus.COMPLETED, TicketStatus.PENDING_TRANS));
            for (TicketStatus target : TicketStatus.values()) {
                if (target != TicketStatus.PENDING_TRANS) {
                    assertFalse(stateMachine.isValidTransition(TicketStatus.COMPLETED, target),
                            "COMPLETED 不应该能转到 " + target);
                }
            }
        }
    }
}
