package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.enums.AuditResult;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.workflow.service.WorkflowService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("FlowableTicketOrchestrator")
class FlowableTicketOrchestratorTest {

    @Mock
    private WorkflowService workflowService;

    @InjectMocks
    private FlowableTicketOrchestrator orchestrator;

    private Ticket ticket;

    @BeforeEach
    void setUp() {
        ticket = new Ticket();
        ticket.setId(7L);
        ticket.setExternalId("FD-7");
        ticket.setSubject("Flowable 测试工单");
        ticket.setStatus(TicketStatus.PROCESSING);
    }

    // =========================================================================
    // onNewTicket
    // =========================================================================

    @Nested
    @DisplayName("onNewTicket")
    class OnNewTicket {

        @Test
        @DisplayName("新工单 → 启动 BPMN 流程实例")
        void newTicket_startsProcess() {
            when(workflowService.startProcess(eq("ticket-standard-flow"), eq("7"), any()))
                    .thenReturn("proc-new-001");

            orchestrator.onNewTicket(ticket);

            verify(workflowService).startProcess(eq("ticket-standard-flow"), eq("7"), any());
        }

        @Test
        @DisplayName("启动失败 → 向上传播异常")
        void newTicket_startFails_throwsException() {
            when(workflowService.startProcess(any(), any(), any()))
                    .thenThrow(new RuntimeException("Flowable 引擎不可用"));

            assertThrows(RuntimeException.class, () -> orchestrator.onNewTicket(ticket));
        }
    }

    // =========================================================================
    // onTranslationCompleted — 并行网关模式下为 no-op
    // =========================================================================

    @Nested
    @DisplayName("onTranslationCompleted (no-op in parallel gateway mode)")
    class OnTranslationCompleted {

        @Test
        @DisplayName("翻译完成 → no-op，不调用 WorkflowService")
        void translationCompleted_isNoOp() {
            orchestrator.onTranslationCompleted(ticket);

            verifyNoInteractions(workflowService);
        }
    }

    // =========================================================================
    // onReplyCompleted — 并行网关模式下为 no-op
    // =========================================================================

    @Nested
    @DisplayName("onReplyCompleted (no-op in parallel gateway mode)")
    class OnReplyCompleted {

        @Test
        @DisplayName("回复完成 → no-op，不调用 WorkflowService")
        void replyCompleted_isNoOp() {
            orchestrator.onReplyCompleted(ticket);

            verifyNoInteractions(workflowService);
        }
    }

    // =========================================================================
    // onAuditCompleted — 手动 signal audit_create_wait
    // =========================================================================

    @Nested
    @DisplayName("onAuditCompleted")
    class OnAuditCompleted {

        @Test
        @DisplayName("审核通过 (PASS) → 信号 audit_create_wait，传递审核变量")
        void auditCompleted_pass_signalsAuditCreateWaitWithVariables() {
            when(workflowService.getProcessInstanceId("7")).thenReturn("proc-003");

            orchestrator.onAuditCompleted(ticket, AuditResult.PASS, "审核意见", 200L, 5L);

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> varsCaptor = ArgumentCaptor.forClass(Map.class);
            verify(workflowService).signalReceiveTask(eq("proc-003"), eq("audit_create_wait"), varsCaptor.capture());

            Map<String, Object> capturedVars = varsCaptor.getValue();
            assertEquals("PASS", capturedVars.get("auditResult"));
            assertEquals("审核意见", capturedVars.get("auditRemark"));
            assertEquals(200L, capturedVars.get("replyId"));
            assertEquals(5L, capturedVars.get("auditorId"));
        }

        @Test
        @DisplayName("审核驳回 (REJECT) → 信号 audit_create_wait，传递驳回相关变量")
        void auditCompleted_reject_signalsAuditCreateWaitWithRejectVariables() {
            when(workflowService.getProcessInstanceId("7")).thenReturn("proc-004");

            orchestrator.onAuditCompleted(ticket, AuditResult.REJECT, "回复不够专业", 201L, 6L);

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> varsCaptor = ArgumentCaptor.forClass(Map.class);
            verify(workflowService).signalReceiveTask(eq("proc-004"), eq("audit_create_wait"), varsCaptor.capture());

            Map<String, Object> capturedVars = varsCaptor.getValue();
            assertEquals("REJECT", capturedVars.get("auditResult"));
            assertEquals("回复不够专业", capturedVars.get("auditRemark"));
            assertEquals(201L, capturedVars.get("replyId"));
            assertEquals(6L, capturedVars.get("auditorId"));
        }

        @Test
        @DisplayName("流程不存在 → 容错处理，不抛异常")
        void auditCompleted_processNotFound_skipsGracefully() {
            when(workflowService.getProcessInstanceId("7")).thenReturn(null);

            assertDoesNotThrow(() ->
                    orchestrator.onAuditCompleted(ticket, AuditResult.PASS, null, 200L, 5L));

            verify(workflowService, never()).signalReceiveTask(any(), any(), any());
        }

        @Test
        @DisplayName("信号调用失败 → 捕获异常，不向上传播")
        void auditCompleted_signalFails_doesNotThrow() {
            when(workflowService.getProcessInstanceId("7")).thenReturn("proc-fail");
            doThrow(new RuntimeException("审核节点不存在"))
                    .when(workflowService).signalReceiveTask(any(), any(), any());

            assertDoesNotThrow(() ->
                    orchestrator.onAuditCompleted(ticket, AuditResult.PASS, null, 200L, 5L));
        }
    }
}
