package com.jefflower.fdserver.workflow.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.task.entity.TaskInstance;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class WorkflowTaskBridgeTest {

    @Mock
    private WorkflowService workflowService;

    @InjectMocks
    private WorkflowTaskBridge workflowTaskBridge;

    // 使用真实 ObjectMapper，避免对 JSON 解析行为打桩
    private final ObjectMapper objectMapper = new ObjectMapper();

    private TaskInstance task;

    @BeforeEach
    void setUp() {
        // 重新构建，注入真实 ObjectMapper
        workflowTaskBridge = new WorkflowTaskBridge(workflowService, objectMapper);

        task = new TaskInstance();
        task.setId(100L);
        task.setTaskType("ticket.translate");
        task.setReferenceId("ticket-42");
    }

    // ========== onTaskCompleted — payload 为空 ==========

    @Test
    void onTaskCompleted_nullPayload_noAction() {
        // given
        task.setPayload(null);

        // when
        workflowTaskBridge.onTaskCompleted(task, Map.of());

        // then — 不应调用 workflowService
        verifyNoInteractions(workflowService);
    }

    @Test
    void onTaskCompleted_emptyPayload_noAction() {
        // given
        task.setPayload("   ");

        // when
        workflowTaskBridge.onTaskCompleted(task, Map.of());

        // then
        verifyNoInteractions(workflowService);
    }

    // ========== onTaskCompleted — JSON 解析失败 ==========

    @Test
    void onTaskCompleted_invalidJson_noException() {
        // given — 非法 JSON
        task.setPayload("{ not valid json }");

        // when / then — 不应抛出异常
        assertDoesNotThrow(() -> workflowTaskBridge.onTaskCompleted(task, Map.of()));
        verifyNoInteractions(workflowService);
    }

    // ========== onTaskCompleted — payload 缺少必要字段 ==========

    @Test
    void onTaskCompleted_missingProcessInstanceId_noAction() throws Exception {
        // given — payload 有 waitActivityId 但缺少 processInstanceId
        String payload = objectMapper.writeValueAsString(Map.of(
                "waitActivityId", "receiveTranslation"
        ));
        task.setPayload(payload);

        // when
        workflowTaskBridge.onTaskCompleted(task, Map.of());

        // then
        verifyNoInteractions(workflowService);
    }

    @Test
    void onTaskCompleted_missingWaitActivityId_noAction() throws Exception {
        // given — payload 有 processInstanceId 但缺少 waitActivityId
        String payload = objectMapper.writeValueAsString(Map.of(
                "processInstanceId", "proc-inst-001"
        ));
        task.setPayload(payload);

        // when
        workflowTaskBridge.onTaskCompleted(task, Map.of());

        // then
        verifyNoInteractions(workflowService);
    }

    @Test
    void onTaskCompleted_bothFieldsMissing_noAction() throws Exception {
        // given — payload 存在但不含流程相关字段
        String payload = objectMapper.writeValueAsString(Map.of(
                "someOtherField", "someValue"
        ));
        task.setPayload(payload);

        // when
        workflowTaskBridge.onTaskCompleted(task, Map.of());

        // then
        verifyNoInteractions(workflowService);
    }

    // ========== onTaskCompleted — 正常唤醒流程 ==========

    @Test
    void onTaskCompleted_success_callsSignalReceiveTask() throws Exception {
        // given
        String processInstanceId = "proc-inst-001";
        String waitActivityId = "receiveTranslation";

        String payload = objectMapper.writeValueAsString(Map.of(
                "processInstanceId", processInstanceId,
                "waitActivityId", waitActivityId
        ));
        task.setPayload(payload);

        Map<String, Object> resultVars = Map.of("translationResult", "translated text");

        // when
        workflowTaskBridge.onTaskCompleted(task, resultVars);

        // then
        verify(workflowService).signalReceiveTask(processInstanceId, waitActivityId, resultVars);
        verifyNoMoreInteractions(workflowService);
    }

    @Test
    void onTaskCompleted_success_withEmptyResultVars() throws Exception {
        // given
        String payload = objectMapper.writeValueAsString(Map.of(
                "processInstanceId", "proc-inst-002",
                "waitActivityId", "receiveReply"
        ));
        task.setPayload(payload);

        // when
        workflowTaskBridge.onTaskCompleted(task, Map.of());

        // then
        verify(workflowService).signalReceiveTask("proc-inst-002", "receiveReply", Map.of());
    }

    // ========== onTaskCompleted — signal 失败时不向上抛 ==========

    @Test
    void onTaskCompleted_signalFails_noException() throws Exception {
        // given
        String payload = objectMapper.writeValueAsString(Map.of(
                "processInstanceId", "proc-inst-003",
                "waitActivityId", "receiveAudit"
        ));
        task.setPayload(payload);

        doThrow(new RuntimeException("flowable signal failed"))
                .when(workflowService).signalReceiveTask(anyString(), anyString(), any());

        // when / then — 异常被内部捕获，不应向上抛出
        assertDoesNotThrow(() -> workflowTaskBridge.onTaskCompleted(task, Map.of()));
    }

    @Test
    void onTaskCompleted_nullResultVars_passedToSignal() throws Exception {
        // given
        String payload = objectMapper.writeValueAsString(Map.of(
                "processInstanceId", "proc-inst-004",
                "waitActivityId", "receiveTranslation"
        ));
        task.setPayload(payload);

        // when
        workflowTaskBridge.onTaskCompleted(task, null);

        // then — null resultVars 也能正常传递给 signalReceiveTask
        verify(workflowService).signalReceiveTask("proc-inst-004", "receiveTranslation", null);
    }
}
