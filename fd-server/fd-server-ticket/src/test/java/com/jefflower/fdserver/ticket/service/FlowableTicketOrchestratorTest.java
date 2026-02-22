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
        ticket.setStatus(TicketStatus.TRANSLATING);
    }

    // =========================================================================
    // onTranslationCompleted
    // =========================================================================

    @Nested
    @DisplayName("onTranslationCompleted")
    class OnTranslationCompleted {

        @Test
        @DisplayName("流程存在 → 信号 translate_wait ReceiveTask")
        void translationCompleted_processExists_signalsTranslateWait() {
            when(workflowService.getProcessInstanceId("7")).thenReturn("proc-001");

            orchestrator.onTranslationCompleted(ticket);

            verify(workflowService).signalReceiveTask(eq("proc-001"), eq("translate_wait"), any());
        }

        @Test
        @DisplayName("流程不存在 → 不发送信号，不抛异常")
        void translationCompleted_processNotFound_skipsSignalGracefully() {
            when(workflowService.getProcessInstanceId("7")).thenReturn(null);

            assertDoesNotThrow(() -> orchestrator.onTranslationCompleted(ticket));

            verify(workflowService, never()).signalReceiveTask(any(), any(), any());
        }

        @Test
        @DisplayName("信号调用抛出异常 → 捕获异常，不向上传播")
        void translationCompleted_signalFails_doesNotThrow() {
            when(workflowService.getProcessInstanceId("7")).thenReturn("proc-fail");
            doThrow(new RuntimeException("Flowable 连接超时"))
                    .when(workflowService).signalReceiveTask(any(), any(), any());

            assertDoesNotThrow(() -> orchestrator.onTranslationCompleted(ticket));
        }

        @Test
        @DisplayName("getProcessInstanceId 使用工单 ID 的字符串形式作为 businessKey")
        void translationCompleted_usesTicketIdAsBusinessKey() {
            ticket.setId(123L);
            when(workflowService.getProcessInstanceId("123")).thenReturn(null);

            orchestrator.onTranslationCompleted(ticket);

            verify(workflowService).getProcessInstanceId("123");
        }
    }

    // =========================================================================
    // onReplyCompleted
    // =========================================================================

    @Nested
    @DisplayName("onReplyCompleted")
    class OnReplyCompleted {

        @Test
        @DisplayName("流程存在 → 信号 reply_wait ReceiveTask")
        void replyCompleted_processExists_signalsReplyWait() {
            when(workflowService.getProcessInstanceId("7")).thenReturn("proc-002");

            orchestrator.onReplyCompleted(ticket);

            verify(workflowService).signalReceiveTask(eq("proc-002"), eq("reply_wait"), any());
        }

        @Test
        @DisplayName("流程不存在 → 容错处理，不抛异常")
        void replyCompleted_processNotFound_skipsGracefully() {
            when(workflowService.getProcessInstanceId("7")).thenReturn(null);

            assertDoesNotThrow(() -> orchestrator.onReplyCompleted(ticket));

            verify(workflowService, never()).signalReceiveTask(any(), any(), any());
        }

        @Test
        @DisplayName("信号调用失败 → 捕获异常，不向上传播")
        void replyCompleted_signalFails_doesNotThrow() {
            when(workflowService.getProcessInstanceId("7")).thenReturn("proc-fail");
            doThrow(new RuntimeException("节点未就绪"))
                    .when(workflowService).signalReceiveTask(any(), any(), any());

            assertDoesNotThrow(() -> orchestrator.onReplyCompleted(ticket));
        }
    }

    // =========================================================================
    // onAuditCompleted
    // =========================================================================

    @Nested
    @DisplayName("onAuditCompleted")
    class OnAuditCompleted {

        @Test
        @DisplayName("审核通过 (PASS) → 信号 audit_wait，传递审核变量")
        void auditCompleted_pass_signalsAuditWaitWithVariables() {
            when(workflowService.getProcessInstanceId("7")).thenReturn("proc-003");

            orchestrator.onAuditCompleted(ticket, AuditResult.PASS, "审核意见", 200L, 5L);

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> varsCaptor = ArgumentCaptor.forClass(Map.class);
            verify(workflowService).signalReceiveTask(eq("proc-003"), eq("audit_wait"), varsCaptor.capture());

            Map<String, Object> capturedVars = varsCaptor.getValue();
            assertEquals("PASS", capturedVars.get("auditResult"));
            assertEquals("审核意见", capturedVars.get("auditRemark"));
            assertEquals(200L, capturedVars.get("replyId"));
            assertEquals(5L, capturedVars.get("auditorId"));
        }

        @Test
        @DisplayName("审核驳回 (REJECT) → 信号 audit_wait，传递驳回相关变量")
        void auditCompleted_reject_signalsAuditWaitWithRejectVariables() {
            when(workflowService.getProcessInstanceId("7")).thenReturn("proc-004");

            orchestrator.onAuditCompleted(ticket, AuditResult.REJECT, "回复不够专业", 201L, 6L);

            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> varsCaptor = ArgumentCaptor.forClass(Map.class);
            verify(workflowService).signalReceiveTask(eq("proc-004"), eq("audit_wait"), varsCaptor.capture());

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
