package com.jefflower.fdserver.ticket.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.task.enums.TriggerType;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketReply;
import com.jefflower.fdserver.ticket.enums.AuditResult;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.repository.TicketReplyRepository;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import com.jefflower.fdserver.ticket.service.notify.NotifyService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("LegacyTicketOrchestrator")
class LegacyTicketOrchestratorTest {

    @Mock
    private TaskDistributionService taskDistributionService;
    @Mock
    private TicketRepository ticketRepository;
    @Mock
    private TicketReplyRepository replyRepository;
    @Mock
    private ReplyPushService replyPushService;
    @Mock
    private SystemConfigService systemConfigService;
    @Mock
    private NotifyService notifyService;
    @Mock
    private AuditTokenService auditTokenService;

    // 真实状态机（无状态纯逻辑组件）
    private final TicketStateMachine stateMachine = new TicketStateMachine();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private LegacyTicketOrchestrator orchestrator;

    private Ticket ticket;

    @BeforeEach
    void setUp() {
        orchestrator = new LegacyTicketOrchestrator(
                taskDistributionService,
                stateMachine,
                ticketRepository,
                replyRepository,
                replyPushService,
                systemConfigService,
                notifyService,
                auditTokenService,
                objectMapper
        );

        ticket = new Ticket();
        ticket.setId(42L);
        ticket.setExternalId("FD-42");
        ticket.setSubject("测试工单");
        ticket.setContent("工单内容");
    }

    // =========================================================================
    // onTranslationCompleted
    // =========================================================================

    @Nested
    @DisplayName("onTranslationCompleted")
    class OnTranslationCompleted {

        @Test
        @DisplayName("标准翻译完成：状态 TRANSLATING → PENDING_REPLY，创建 reply 任务")
        void translationCompleted_fromTranslating_transitionsAndCreatesReplyTask() {
            ticket.setStatus(TicketStatus.TRANSLATING);

            orchestrator.onTranslationCompleted(ticket);

            // 验证完成 translate 任务
            verify(taskDistributionService).completeByReference("ticket.translate", "42");

            // 验证状态已转换
            assertEquals(TicketStatus.PENDING_REPLY, ticket.getStatus());
            verify(ticketRepository).save(ticket);

            // 验证创建了 reply 任务
            verify(taskDistributionService).createTask(
                    eq("ticket.reply"),
                    eq("ticket"),
                    eq("42"),
                    anyString(),
                    eq(TriggerType.EVENT)
            );
        }

        @Test
        @DisplayName("标准翻译完成：状态 PENDING_TRANS → PENDING_REPLY（幂等跳过），创建 reply 任务")
        void translationCompleted_fromPendingTrans_transitionsAndCreatesReplyTask() {
            ticket.setStatus(TicketStatus.PENDING_TRANS);

            orchestrator.onTranslationCompleted(ticket);

            verify(taskDistributionService).completeByReference("ticket.translate", "42");
            assertEquals(TicketStatus.PENDING_REPLY, ticket.getStatus());
            verify(ticketRepository).save(ticket);
            verify(taskDistributionService).createTask(
                    eq("ticket.reply"), eq("ticket"), eq("42"), anyString(), eq(TriggerType.EVENT));
        }

        @Test
        @DisplayName("状态已是 PENDING_REPLY → 幂等处理：不转换状态、不重复创建 reply 任务")
        void translationCompleted_alreadyPendingReply_idempotent() {
            ticket.setStatus(TicketStatus.PENDING_REPLY);

            orchestrator.onTranslationCompleted(ticket);

            // 仍然完成 translate 任务（幂等）
            verify(taskDistributionService).completeByReference("ticket.translate", "42");

            // 不应再次转换状态和创建任务
            verify(ticketRepository, never()).save(any());
            verify(taskDistributionService, never()).createTask(
                    eq("ticket.reply"), any(), any(), any(), any());

            // 状态保持不变
            assertEquals(TicketStatus.PENDING_REPLY, ticket.getStatus());
        }

        @Test
        @DisplayName("completeByReference 调用参数正确：类型=ticket.translate，referenceId=工单ID字符串")
        void translationCompleted_completeByReferenceCalledWithCorrectArgs() {
            ticket.setStatus(TicketStatus.TRANSLATING);
            ticket.setId(999L);

            orchestrator.onTranslationCompleted(ticket);

            ArgumentCaptor<String> typeCaptor = ArgumentCaptor.forClass(String.class);
            ArgumentCaptor<String> refCaptor = ArgumentCaptor.forClass(String.class);
            verify(taskDistributionService).completeByReference(typeCaptor.capture(), refCaptor.capture());
            assertEquals("ticket.translate", typeCaptor.getValue());
            assertEquals("999", refCaptor.getValue());
        }

        @Test
        @DisplayName("创建 reply 任务：payload 包含 ticketId")
        void translationCompleted_taskPayloadContainsTicketId() {
            ticket.setStatus(TicketStatus.TRANSLATING);

            orchestrator.onTranslationCompleted(ticket);

            ArgumentCaptor<String> payloadCaptor = ArgumentCaptor.forClass(String.class);
            verify(taskDistributionService).createTask(
                    any(), any(), any(), payloadCaptor.capture(), any());
            assertTrue(payloadCaptor.getValue().contains("42"),
                    "payload 应包含 ticketId");
        }
    }

    // =========================================================================
    // onReplyCompleted
    // =========================================================================

    @Nested
    @DisplayName("onReplyCompleted")
    class OnReplyCompleted {

        @BeforeEach
        void setUpReplyTicket() {
            ticket.setStatus(TicketStatus.REPLYING);
            when(auditTokenService.generateToken(anyLong())).thenReturn("mock-audit-token");
        }

        @Test
        @DisplayName("标准回复完成：状态 REPLYING → PENDING_AUDIT，完成 reply 任务，创建 audit 任务")
        void replyCompleted_fromReplying_transitionsAndCreatesAuditTask() {
            orchestrator.onReplyCompleted(ticket);

            assertEquals(TicketStatus.PENDING_AUDIT, ticket.getStatus());
            verify(ticketRepository).save(ticket);

            verify(taskDistributionService).completeByReference("ticket.reply", "42");
            verify(taskDistributionService).createTask(
                    eq("ticket.audit"),
                    eq("ticket"),
                    eq("42"),
                    anyString(),
                    eq(TriggerType.EVENT)
            );
        }

        @Test
        @DisplayName("回复完成后：发送审核通知（含 auditToken）")
        void replyCompleted_sendsAuditNotification() {
            orchestrator.onReplyCompleted(ticket);

            verify(auditTokenService).generateToken(42L);
            verify(notifyService).notifyPendingAudit(eq(ticket), eq("mock-audit-token"));
        }

        @Test
        @DisplayName("回复完成：auditToken 生成后传入 notifyPendingAudit")
        void replyCompleted_auditTokenPassedToNotify() {
            when(auditTokenService.generateToken(42L)).thenReturn("specific-token-xyz");

            orchestrator.onReplyCompleted(ticket);

            verify(notifyService).notifyPendingAudit(ticket, "specific-token-xyz");
        }
    }

    // =========================================================================
    // onAuditCompleted - PASS
    // =========================================================================

    @Nested
    @DisplayName("onAuditCompleted - 审核通过 (PASS)")
    class OnAuditCompletedPass {

        private TicketReply reply;

        @BeforeEach
        void setUpAuditTicket() {
            ticket.setStatus(TicketStatus.AUDITING);
            reply = new TicketReply();
            reply.setId(100L);
            reply.setIsSelected(false);
            when(replyRepository.findById(100L)).thenReturn(Optional.of(reply));
        }

        @Test
        @DisplayName("审核通过 + 自动推送开启 → 状态 COMPLETED，推送到 Freshdesk")
        void auditPass_autoReplyEnabled_completedAndPushed() {
            when(systemConfigService.isAutoReplyEnabled()).thenReturn(true);

            orchestrator.onAuditCompleted(ticket, AuditResult.PASS, null, 100L, 1L);

            assertEquals(TicketStatus.COMPLETED, ticket.getStatus());
            verify(replyPushService).pushReplyToFreshdesk(ticket, reply);
        }

        @Test
        @DisplayName("审核通过 + 自动推送关闭 → 状态 APPROVED，不推送 Freshdesk")
        void auditPass_autoReplyDisabled_approvedAndNotPushed() {
            when(systemConfigService.isAutoReplyEnabled()).thenReturn(false);

            orchestrator.onAuditCompleted(ticket, AuditResult.PASS, null, 100L, 1L);

            assertEquals(TicketStatus.APPROVED, ticket.getStatus());
            verify(replyPushService, never()).pushReplyToFreshdesk(any(), any());
        }

        @Test
        @DisplayName("审核通过 → 选中回复（reply.isSelected = true）")
        void auditPass_setsReplySelected() {
            when(systemConfigService.isAutoReplyEnabled()).thenReturn(false);

            orchestrator.onAuditCompleted(ticket, AuditResult.PASS, null, 100L, 1L);

            assertTrue(reply.getIsSelected(), "审核通过后 reply.isSelected 应为 true");
            verify(replyRepository).save(reply);
        }

        @Test
        @DisplayName("审核通过 → 清空 lastAuditRemark")
        void auditPass_clearsLastAuditRemark() {
            ticket.setLastAuditRemark("之前的驳回意见");
            when(systemConfigService.isAutoReplyEnabled()).thenReturn(false);

            orchestrator.onAuditCompleted(ticket, AuditResult.PASS, null, 100L, 1L);

            assertNull(ticket.getLastAuditRemark(), "审核通过后 lastAuditRemark 应被清空");
            verify(ticketRepository).save(ticket);
        }

        @Test
        @DisplayName("审核通过 → 发送通过通知")
        void auditPass_sendsPassNotification() {
            when(systemConfigService.isAutoReplyEnabled()).thenReturn(false);

            orchestrator.onAuditCompleted(ticket, AuditResult.PASS, null, 100L, 1L);

            verify(notifyService).notifyAuditPass(ticket);
        }

        @Test
        @DisplayName("审核通过 → 完成 audit 任务")
        void auditPass_completesAuditTask() {
            when(systemConfigService.isAutoReplyEnabled()).thenReturn(false);

            orchestrator.onAuditCompleted(ticket, AuditResult.PASS, null, 100L, 1L);

            verify(taskDistributionService).completeByReference("ticket.audit", "42");
        }
    }

    // =========================================================================
    // onAuditCompleted - REJECT
    // =========================================================================

    @Nested
    @DisplayName("onAuditCompleted - 审核驳回 (REJECT)")
    class OnAuditCompletedReject {

        @BeforeEach
        void setUpAuditTicket() {
            ticket.setStatus(TicketStatus.AUDITING);
        }

        @Test
        @DisplayName("审核驳回 → 状态回退 PENDING_REPLY")
        void auditReject_transitionsToPendingReply() {
            orchestrator.onAuditCompleted(ticket, AuditResult.REJECT, "回复不够专业", null, 1L);

            assertEquals(TicketStatus.PENDING_REPLY, ticket.getStatus());
        }

        @Test
        @DisplayName("审核驳回 → 保存 lastAuditRemark")
        void auditReject_savesAuditRemark() {
            orchestrator.onAuditCompleted(ticket, AuditResult.REJECT, "需要更详细的解答", null, 1L);

            assertEquals("需要更详细的解答", ticket.getLastAuditRemark());
            verify(ticketRepository).save(ticket);
        }

        @Test
        @DisplayName("审核驳回 → 创建新的 reply 任务（重新回复）")
        void auditReject_createsNewReplyTask() {
            orchestrator.onAuditCompleted(ticket, AuditResult.REJECT, "remark", null, 1L);

            verify(taskDistributionService).createTask(
                    eq("ticket.reply"),
                    eq("ticket"),
                    eq("42"),
                    anyString(),
                    eq(TriggerType.EVENT)
            );
        }

        @Test
        @DisplayName("审核驳回 → 发送驳回通知（含驳回意见）")
        void auditReject_sendsRejectNotification() {
            orchestrator.onAuditCompleted(ticket, AuditResult.REJECT, "语气太强硬", null, 1L);

            verify(notifyService).notifyAuditReject(ticket, "语气太强硬");
        }

        @Test
        @DisplayName("审核驳回 → 不调用 replyPushService")
        void auditReject_doesNotPushToFreshdesk() {
            orchestrator.onAuditCompleted(ticket, AuditResult.REJECT, "remark", null, 1L);

            verify(replyPushService, never()).pushReplyToFreshdesk(any(), any());
        }

        @Test
        @DisplayName("审核驳回 → 完成 audit 任务")
        void auditReject_completesAuditTask() {
            orchestrator.onAuditCompleted(ticket, AuditResult.REJECT, "remark", null, 1L);

            verify(taskDistributionService).completeByReference("ticket.audit", "42");
        }

        @Test
        @DisplayName("驳回意见为 null → lastAuditRemark 设为 null（不抛异常）")
        void auditReject_nullRemark_setsNullLastAuditRemark() {
            assertDoesNotThrow(() ->
                    orchestrator.onAuditCompleted(ticket, AuditResult.REJECT, null, null, 1L));

            assertNull(ticket.getLastAuditRemark());
            verify(notifyService).notifyAuditReject(ticket, null);
        }
    }
}
