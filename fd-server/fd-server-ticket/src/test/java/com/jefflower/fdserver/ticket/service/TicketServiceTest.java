package com.jefflower.fdserver.ticket.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ticket.dto.AuditRequest;
import com.jefflower.fdserver.ticket.dto.ReplyRequest;
import com.jefflower.fdserver.ticket.dto.TranslationRequest;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketAudit;
import com.jefflower.fdserver.ticket.entity.TicketReply;
import com.jefflower.fdserver.ticket.entity.TicketTranslation;
import com.jefflower.fdserver.ticket.enums.AuditResult;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.repository.TicketAuditRepository;
import com.jefflower.fdserver.ticket.repository.TicketReplyRepository;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import com.jefflower.fdserver.ticket.repository.TicketTranslationRepository;
import com.jefflower.fdserver.ticket.service.notify.NotifyService;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class TicketServiceTest {

    @Mock
    private TicketRepository ticketRepository;
    @Mock
    private TicketTranslationRepository translationRepository;
    @Mock
    private TicketReplyRepository replyRepository;
    @Mock
    private TicketAuditRepository auditRepository;
    @Mock
    private ReplyPushService replyPushService;
    @Mock
    private SystemConfigService systemConfigService;
    @Mock
    private NotifyService notifyService;
    @Mock
    private AuditTokenService auditTokenService;
    @Mock
    private TaskDistributionService taskDistributionService;
    @Mock
    private TicketWorkflowOrchestrator orchestrator;

    // 使用真实实例（无状态纯逻辑组件）
    private final TicketStateMachine stateMachine = new TicketStateMachine();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private TicketService ticketService;

    private Ticket sampleTicket;

    @BeforeEach
    void setUp() {
        ticketService = new TicketService(
                ticketRepository,
                translationRepository,
                replyRepository,
                auditRepository,
                replyPushService,
                systemConfigService,
                notifyService,
                auditTokenService,
                taskDistributionService,
                stateMachine,
                objectMapper,
                orchestrator
        );

        sampleTicket = new Ticket();
        sampleTicket.setId(1L);
        sampleTicket.setExternalId("FD-1001");
        sampleTicket.setSubject("Test ticket");
        sampleTicket.setContent("Some content");
        sampleTicket.setStatus(TicketStatus.PENDING_TRANS);
        sampleTicket.setCreatedAt(LocalDateTime.now());
    }

    // =========================================================================
    // getTicketById
    // =========================================================================

    @Nested
    @DisplayName("getTicketById")
    class GetTicketById {

        @Test
        @DisplayName("存在的工单 → 正常返回（通过 EntityGraph 加载关联数据）")
        void returnsTicketWhenExists() {
            when(ticketRepository.findByIdWithAssociations(1L)).thenReturn(Optional.of(sampleTicket));

            Ticket result = ticketService.getTicketById(1L);

            assertSame(sampleTicket, result);
        }

        @Test
        @DisplayName("不存在的工单 → 抛出 RuntimeException")
        void throwsWhenNotFound() {
            when(ticketRepository.findByIdWithAssociations(99L)).thenReturn(Optional.empty());

            RuntimeException ex = assertThrows(RuntimeException.class,
                    () -> ticketService.getTicketById(99L));
            assertTrue(ex.getMessage().contains("99"));
        }
    }

    // =========================================================================
    // queryTickets
    // =========================================================================

    @Nested
    @DisplayName("queryTickets")
    class QueryTickets {

        @Test
        @DisplayName("委托到 repository.findByFilters 并返回分页结果")
        void delegatesToRepository() {
            Page<Ticket> page = new PageImpl<>(List.of(sampleTicket));
            when(ticketRepository.findByFilters(any(), any(), any(), any(), any(), any(), any(Pageable.class)))
                    .thenReturn(page);

            Page<Ticket> result = ticketService.queryTickets(
                    TicketStatus.PENDING_TRANS, null, null, null, null, null, 0, 10);

            assertEquals(1, result.getTotalElements());
            assertSame(sampleTicket, result.getContent().get(0));
        }
    }

    // =========================================================================
    // submitTranslation
    // =========================================================================

    @Nested
    @DisplayName("submitTranslation")
    class SubmitTranslation {

        private TranslationRequest translationRequest;

        @BeforeEach
        void setUp() {
            translationRequest = new TranslationRequest();
            translationRequest.setTargetLang("zh-CN");
            translationRequest.setTranslatedTitle("翻译标题");
            translationRequest.setTranslatedContent("翻译内容");

            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));
        }

        @Test
        @DisplayName("首次翻译 → 保存翻译、委托编排器处理后续流程")
        void firstTranslation_savesAndTransitions() {
            when(translationRepository.findByTicketAndTargetLang(sampleTicket, "zh-CN"))
                    .thenReturn(Optional.empty());
            TicketTranslation saved = new TicketTranslation();
            saved.setId(10L);
            when(translationRepository.save(any(TicketTranslation.class))).thenReturn(saved);

            TicketTranslation result = ticketService.submitTranslation(1L, translationRequest);

            assertEquals(10L, result.getId());

            // 验证编排器被调用
            verify(orchestrator).onTranslationCompleted(sampleTicket);
        }

        @Test
        @DisplayName("已有同语言翻译 → 先删除旧翻译再保存新翻译")
        void existingTranslation_deletesOldFirst() {
            TicketTranslation existing = new TicketTranslation();
            existing.setId(5L);
            when(translationRepository.findByTicketAndTargetLang(sampleTicket, "zh-CN"))
                    .thenReturn(Optional.of(existing));
            when(translationRepository.save(any(TicketTranslation.class)))
                    .thenReturn(new TicketTranslation());

            ticketService.submitTranslation(1L, translationRequest);

            verify(translationRepository).delete(existing);
        }

        @Test
        @DisplayName("工单已是 PENDING_REPLY → 不重复创建任务")
        void alreadyPendingReply_noTaskCreated() {
            sampleTicket.setStatus(TicketStatus.PENDING_REPLY);
            when(translationRepository.findByTicketAndTargetLang(sampleTicket, "zh-CN"))
                    .thenReturn(Optional.empty());
            when(translationRepository.save(any(TicketTranslation.class)))
                    .thenReturn(new TicketTranslation());

            ticketService.submitTranslation(1L, translationRequest);

            // 不应该再次保存工单或创建任务
            verify(ticketRepository, never()).save(any(Ticket.class));
        }

        @Test
        @DisplayName("翻译内容正确映射到 TicketTranslation 实体")
        void fieldsMappedCorrectly() {
            when(translationRepository.findByTicketAndTargetLang(sampleTicket, "zh-CN"))
                    .thenReturn(Optional.empty());
            ArgumentCaptor<TicketTranslation> captor = ArgumentCaptor.forClass(TicketTranslation.class);
            when(translationRepository.save(captor.capture())).thenAnswer(inv -> inv.getArgument(0));

            ticketService.submitTranslation(1L, translationRequest);

            TicketTranslation captured = captor.getValue();
            assertSame(sampleTicket, captured.getTicket());
            assertEquals("zh-CN", captured.getTargetLang());
            assertEquals("翻译标题", captured.getTranslatedTitle());
            assertEquals("翻译内容", captured.getTranslatedContent());
        }
    }

    // =========================================================================
    // submitReply
    // =========================================================================

    @Nested
    @DisplayName("submitReply")
    class SubmitReply {

        private ReplyRequest replyRequest;

        @BeforeEach
        void setUp() {
            replyRequest = new ReplyRequest();
            replyRequest.setZhReply("中文回复");
            replyRequest.setTargetReply("English reply");

            sampleTicket.setStatus(TicketStatus.PENDING_REPLY);
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));
        }

        @Test
        @DisplayName("提交回复 → 删除旧回复、保存新回复、委托编排器处理后续流程")
        void submitsReplyAndTransitions() {
            TicketReply saved = new TicketReply();
            saved.setId(20L);
            when(replyRepository.save(any(TicketReply.class))).thenReturn(saved);

            TicketReply result = ticketService.submitReply(1L, replyRequest);

            assertEquals(20L, result.getId());
            verify(replyRepository).deleteByTicket(sampleTicket);
            verify(orchestrator).onReplyCompleted(sampleTicket);
        }

        @Test
        @DisplayName("回复字段正确映射")
        void fieldsMappedCorrectly() {
            ArgumentCaptor<TicketReply> captor = ArgumentCaptor.forClass(TicketReply.class);
            when(replyRepository.save(captor.capture())).thenAnswer(inv -> inv.getArgument(0));

            ticketService.submitReply(1L, replyRequest);

            TicketReply captured = captor.getValue();
            assertSame(sampleTicket, captured.getTicket());
            assertEquals("中文回复", captured.getZhReply());
            assertEquals("English reply", captured.getTargetReply());
        }
    }

    // =========================================================================
    // submitAudit
    // =========================================================================

    @Nested
    @DisplayName("submitAudit")
    class SubmitAudit {

        @BeforeEach
        void setUp() {
            sampleTicket.setStatus(TicketStatus.PENDING_AUDIT);
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));
        }

        private void stubDefaultAuditSave() {
            when(auditRepository.save(any(TicketAudit.class))).thenAnswer(inv -> {
                TicketAudit a = inv.getArgument(0);
                a.setId(30L);
                return a;
            });
        }

        @Test
        @DisplayName("审核通过 → 保存审核记录、委托编排器处理后续流程")
        void pass_autoReplyDisabled_approved() {
            stubDefaultAuditSave();
            AuditRequest req = new AuditRequest();
            req.setReplyId(20L);
            req.setAuditResult(AuditResult.PASS);

            ticketService.submitAudit(1L, req, 100L);

            verify(orchestrator).onAuditCompleted(sampleTicket, AuditResult.PASS, null, 20L, 100L);
        }

        @Test
        @DisplayName("审核通过 → 编排器被调用（自动推送场景由编排器决定）")
        void pass_autoReplyEnabled_completed() {
            stubDefaultAuditSave();
            AuditRequest req = new AuditRequest();
            req.setReplyId(20L);
            req.setAuditResult(AuditResult.PASS);

            ticketService.submitAudit(1L, req, 100L);

            verify(orchestrator).onAuditCompleted(sampleTicket, AuditResult.PASS, null, 20L, 100L);
        }

        @Test
        @DisplayName("审核驳回 → 委托编排器处理后续流程")
        void reject_rollsBackToPendingReply() {
            stubDefaultAuditSave();
            AuditRequest req = new AuditRequest();
            req.setReplyId(20L);
            req.setAuditResult(AuditResult.REJECT);
            req.setAuditRemark("回复质量不佳");

            ticketService.submitAudit(1L, req, 100L);

            verify(orchestrator).onAuditCompleted(sampleTicket, AuditResult.REJECT, "回复质量不佳", 20L, 100L);
        }

        @Test
        @DisplayName("审核 → 编排器始终被调用（异常由编排器处理）")
        void pass_replyNotFound_throws() {
            stubDefaultAuditSave();
            AuditRequest req = new AuditRequest();
            req.setReplyId(999L);
            req.setAuditResult(AuditResult.PASS);

            ticketService.submitAudit(1L, req, 100L);

            verify(orchestrator).onAuditCompleted(sampleTicket, AuditResult.PASS, null, 999L, 100L);
        }

        @Test
        @DisplayName("审核记录字段正确映射")
        void auditFieldsMappedCorrectly() {
            AuditRequest req = new AuditRequest();
            req.setReplyId(20L);
            req.setAuditResult(AuditResult.REJECT);
            req.setAuditRemark("需改进");

            ArgumentCaptor<TicketAudit> captor = ArgumentCaptor.forClass(TicketAudit.class);
            when(auditRepository.save(captor.capture())).thenAnswer(inv -> inv.getArgument(0));

            ticketService.submitAudit(1L, req, 100L);

            TicketAudit captured = captor.getValue();
            assertSame(sampleTicket, captured.getTicket());
            assertEquals(20L, captured.getReplyId());
            assertEquals(AuditResult.REJECT, captured.getAuditResult());
            assertEquals("需改进", captured.getAuditRemark());
            assertEquals(100L, captured.getAuditorId());
        }
    }

    // =========================================================================
    // updateReply
    // =========================================================================

    @Nested
    @DisplayName("updateReply")
    class UpdateReply {

        @Test
        @DisplayName("更新属于该工单的回复 → 正常保存")
        void updatesReplySuccessfully() {
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));
            TicketReply reply = new TicketReply();
            reply.setId(20L);
            reply.setTicket(sampleTicket);
            when(replyRepository.findById(20L)).thenReturn(Optional.of(reply));
            when(replyRepository.save(any(TicketReply.class))).thenAnswer(inv -> inv.getArgument(0));

            ReplyRequest req = new ReplyRequest();
            req.setZhReply("新中文");
            req.setTargetReply("New EN");

            TicketReply result = ticketService.updateReply(1L, 20L, req);

            assertEquals("新中文", result.getZhReply());
            assertEquals("New EN", result.getTargetReply());
        }

        @Test
        @DisplayName("回复不属于该工单 → 抛出异常")
        void replyBelongsToDifferentTicket_throws() {
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));

            Ticket otherTicket = new Ticket();
            otherTicket.setId(2L);
            TicketReply reply = new TicketReply();
            reply.setId(20L);
            reply.setTicket(otherTicket);
            when(replyRepository.findById(20L)).thenReturn(Optional.of(reply));

            ReplyRequest req = new ReplyRequest();
            assertThrows(RuntimeException.class,
                    () -> ticketService.updateReply(1L, 20L, req));
        }

        @Test
        @DisplayName("回复 ID 不存在 → 抛出异常")
        void replyNotFound_throws() {
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));
            when(replyRepository.findById(999L)).thenReturn(Optional.empty());

            ReplyRequest req = new ReplyRequest();
            assertThrows(RuntimeException.class,
                    () -> ticketService.updateReply(1L, 999L, req));
        }
    }

    // =========================================================================
    // pushApprovedReply
    // =========================================================================

    @Nested
    @DisplayName("pushApprovedReply")
    class PushApprovedReply {

        @Test
        @DisplayName("APPROVED 工单 + 有选中回复 → 推送并变为 COMPLETED")
        void pushesSuccessfully() {
            sampleTicket.setStatus(TicketStatus.APPROVED);
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));

            TicketReply selectedReply = new TicketReply();
            selectedReply.setId(20L);
            selectedReply.setIsSelected(true);
            when(replyRepository.findByTicket(sampleTicket)).thenReturn(List.of(selectedReply));
            when(ticketRepository.save(any(Ticket.class))).thenReturn(sampleTicket);

            ticketService.pushApprovedReply(1L);

            assertEquals(TicketStatus.COMPLETED, sampleTicket.getStatus());
            verify(replyPushService).pushReplyToFreshdesk(sampleTicket, selectedReply);
            verify(notifyService).notifyReplyPushed(sampleTicket);
        }

        @Test
        @DisplayName("非 APPROVED 状态 → 抛出异常")
        void notApproved_throws() {
            sampleTicket.setStatus(TicketStatus.PENDING_AUDIT);
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));

            RuntimeException ex = assertThrows(RuntimeException.class,
                    () -> ticketService.pushApprovedReply(1L));
            assertTrue(ex.getMessage().contains("APPROVED"));
        }

        @Test
        @DisplayName("APPROVED 但无选中回复 → 抛出异常")
        void noSelectedReply_throws() {
            sampleTicket.setStatus(TicketStatus.APPROVED);
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));

            TicketReply unselectedReply = new TicketReply();
            unselectedReply.setIsSelected(false);
            when(replyRepository.findByTicket(sampleTicket)).thenReturn(List.of(unselectedReply));

            assertThrows(RuntimeException.class,
                    () -> ticketService.pushApprovedReply(1L));
        }
    }

    // =========================================================================
    // batchPushApprovedReplies
    // =========================================================================

    @Nested
    @DisplayName("batchPushApprovedReplies")
    class BatchPush {

        @Test
        @DisplayName("批量推送 — 部分成功部分失败 → 返回成功计数")
        void partialSuccess() {
            Ticket t1 = new Ticket();
            t1.setId(1L);
            t1.setStatus(TicketStatus.APPROVED);
            Ticket t2 = new Ticket();
            t2.setId(2L);
            t2.setStatus(TicketStatus.PENDING_AUDIT); // 会失败

            when(ticketRepository.findById(1L)).thenReturn(Optional.of(t1));
            when(ticketRepository.findById(2L)).thenReturn(Optional.of(t2));

            TicketReply r1 = new TicketReply();
            r1.setId(10L);
            r1.setIsSelected(true);
            when(replyRepository.findByTicket(t1)).thenReturn(List.of(r1));
            when(ticketRepository.save(any(Ticket.class))).thenAnswer(inv -> inv.getArgument(0));

            int count = ticketService.batchPushApprovedReplies(List.of(1L, 2L));

            assertEquals(1, count);
        }
    }

    // =========================================================================
    // skipReply
    // =========================================================================

    @Nested
    @DisplayName("skipReply")
    class SkipReply {

        @Test
        @DisplayName("跳过回复 → 直接标记为 COMPLETED")
        void skipsToCompleted() {
            sampleTicket.setStatus(TicketStatus.PENDING_REPLY);
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));
            when(ticketRepository.save(any(Ticket.class))).thenReturn(sampleTicket);

            ticketService.skipReply(1L);

            assertEquals(TicketStatus.COMPLETED, sampleTicket.getStatus());
            assertNotNull(sampleTicket.getUpdatedAt());
        }
    }

    // =========================================================================
    // triggerAiTranslation
    // =========================================================================

    @Nested
    @DisplayName("triggerAiTranslation")
    class TriggerAiTranslation {

        @Test
        @DisplayName("触发翻译 → 状态变为 TRANSLATING，创建翻译任务")
        void triggersTranslation() {
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));
            when(ticketRepository.save(any(Ticket.class))).thenReturn(sampleTicket);

            ticketService.triggerAiTranslation(1L);

            assertEquals(TicketStatus.TRANSLATING, sampleTicket.getStatus());
        }
    }

    // =========================================================================
    // triggerAiReply
    // =========================================================================

    @Nested
    @DisplayName("triggerAiReply")
    class TriggerAiReply {

        @Test
        @DisplayName("有翻译 → 状态变为 REPLYING，创建回复任务")
        void triggersReply() {
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));
            when(translationRepository.existsByTicket(sampleTicket)).thenReturn(true);
            when(ticketRepository.save(any(Ticket.class))).thenReturn(sampleTicket);

            ticketService.triggerAiReply(1L);

            assertEquals(TicketStatus.REPLYING, sampleTicket.getStatus());
        }

        @Test
        @DisplayName("无翻译 → 抛出异常，不创建任务")
        void noTranslation_throws() {
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));
            when(translationRepository.existsByTicket(sampleTicket)).thenReturn(false);

            RuntimeException ex = assertThrows(RuntimeException.class,
                    () -> ticketService.triggerAiReply(1L));
            assertTrue(ex.getMessage().contains("翻译"));
        }
    }

    // =========================================================================
    // updateValidity
    // =========================================================================

    @Nested
    @DisplayName("updateValidity")
    class UpdateValidity {

        @Test
        @DisplayName("更新有效性标记")
        void updatesIsValid() {
            when(ticketRepository.findById(1L)).thenReturn(Optional.of(sampleTicket));
            when(ticketRepository.save(any(Ticket.class))).thenAnswer(inv -> inv.getArgument(0));

            Ticket result = ticketService.updateValidity(1L, true);

            assertTrue(result.getIsValid());
            verify(ticketRepository).save(sampleTicket);
        }
    }
}
