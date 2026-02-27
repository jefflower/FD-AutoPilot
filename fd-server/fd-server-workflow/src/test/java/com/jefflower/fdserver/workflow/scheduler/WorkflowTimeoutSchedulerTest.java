package com.jefflower.fdserver.workflow.scheduler;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import com.jefflower.fdserver.workflow.service.WorkflowService;
import com.jefflower.fdserver.workflow.service.WorkflowTaskBridge;
import org.flowable.engine.runtime.Execution;
import org.flowable.engine.runtime.ProcessInstance;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.mockito.Mockito.lenient;

@ExtendWith(MockitoExtension.class)
@DisplayName("WorkflowTimeoutScheduler")
class WorkflowTimeoutSchedulerTest {

    @Mock
    private WorkflowService workflowService;
    @Mock
    private WorkflowTaskBridge taskBridge;
    @Mock
    private TaskInstanceRepository taskInstanceRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private WorkflowTimeoutScheduler scheduler;

    @BeforeEach
    void setUp() {
        scheduler = new WorkflowTimeoutScheduler(
                workflowService, taskBridge, taskInstanceRepository, objectMapper);
    }

    // =========================================================================
    // recoverStuckReceiveTasks — 入口方法
    // =========================================================================

    @Nested
    @DisplayName("recoverStuckReceiveTasks")
    class RecoverStuckReceiveTasks {

        @Test
        @DisplayName("无卡住流程 → 无操作")
        void noStuckProcesses_noAction() {
            when(workflowService.findStuckProcessInstances(any())).thenReturn(List.of());

            scheduler.recoverStuckReceiveTasks();

            verify(workflowService).findStuckProcessInstances(any());
            verifyNoMoreInteractions(workflowService);
            verifyNoInteractions(taskBridge, taskInstanceRepository);
        }

        @Test
        @DisplayName("有卡住流程 → 逐个处理")
        void hasStuckProcesses_handlesEach() {
            ProcessInstance p1 = mockProcessInstance("proc-1", "bk-1",
                    Instant.now().minus(Duration.ofMinutes(60)));
            ProcessInstance p2 = mockProcessInstance("proc-2", "bk-2",
                    Instant.now().minus(Duration.ofMinutes(45)));

            when(workflowService.findStuckProcessInstances(any())).thenReturn(List.of(p1, p2));
            // 两个流程都没有活跃的 ReceiveTask
            when(workflowService.findReceiveTaskExecution(anyString(), anyString())).thenReturn(null);

            scheduler.recoverStuckReceiveTasks();

            verify(workflowService).findStuckProcessInstances(any());
            // 每个流程检查 agent(2) + human(1) = 3 个 ReceiveTask
            verify(workflowService, times(6)).findReceiveTaskExecution(anyString(), anyString());
        }

        @Test
        @DisplayName("处理某个流程异常 → 不影响其他流程")
        void exceptionInOneProcess_othersContinue() {
            ProcessInstance p1 = mockProcessInstance("proc-err", "bk-err",
                    Instant.now().minus(Duration.ofMinutes(60)));
            ProcessInstance p2 = mockProcessInstance("proc-ok", "bk-ok",
                    Instant.now().minus(Duration.ofMinutes(45)));

            when(workflowService.findStuckProcessInstances(any())).thenReturn(List.of(p1, p2));
            when(workflowService.findReceiveTaskExecution(eq("proc-err"), anyString()))
                    .thenThrow(new RuntimeException("Flowable 异常"));
            when(workflowService.findReceiveTaskExecution(eq("proc-ok"), anyString()))
                    .thenReturn(null);

            assertDoesNotThrow(() -> scheduler.recoverStuckReceiveTasks());

            // proc-ok 的检查仍正常进行
            verify(workflowService, atLeastOnce()).findReceiveTaskExecution(eq("proc-ok"), anyString());
        }
    }

    // =========================================================================
    // handleStuckProcess — 硬超时
    // =========================================================================

    @Nested
    @DisplayName("handleStuckProcess — 硬超时")
    class HardTimeout {

        @Test
        @DisplayName("超过 24 小时 → 强制终止")
        void exceedsHardTimeout_terminates() {
            ProcessInstance process = mockProcessInstance("proc-old", "bk-old",
                    Instant.now().minus(Duration.ofHours(25)));

            int result = scheduler.handleStuckProcess(process);

            assertEquals(-1, result);
            verify(workflowService).terminateProcess(eq("proc-old"), contains("Hard timeout exceeded"));
            // 不应检查 ReceiveTask
            verify(workflowService, never()).findReceiveTaskExecution(anyString(), anyString());
        }

        @Test
        @DisplayName("恰好 24 小时内 → 不终止，继续检查 ReceiveTask")
        void withinHardTimeout_doesNotTerminate() {
            ProcessInstance process = mockProcessInstance("proc-recent", "bk-recent",
                    Instant.now().minus(Duration.ofHours(23)));
            when(workflowService.findReceiveTaskExecution(anyString(), anyString())).thenReturn(null);

            int result = scheduler.handleStuckProcess(process);

            assertEquals(0, result);
            verify(workflowService, never()).terminateProcess(anyString(), anyString());
        }
    }

    // =========================================================================
    // tryRecoverAgentReceiveTask — 信号恢复
    // =========================================================================

    @Nested
    @DisplayName("tryRecoverAgentReceiveTask")
    class TryRecoverAgent {

        @Test
        @DisplayName("TaskInstance COMPLETED + waitActivityId 匹配 → 重新桥接 (taskSuccess=true)")
        void completedTask_reBridgesSuccessfully() throws Exception {
            String processInstanceId = "proc-001";
            String activityId = "translate_agent_wait";
            TaskInstance task = buildTaskInstance(101L, TaskStatus.COMPLETED,
                    processInstanceId, activityId);

            when(taskInstanceRepository.findByPayloadContainingAndStatusIn(
                    eq(processInstanceId), eq(List.of(TaskStatus.COMPLETED, TaskStatus.TIMEOUT))))
                    .thenReturn(List.of(task));

            boolean recovered = scheduler.tryRecoverAgentReceiveTask(processInstanceId, activityId);

            assertTrue(recovered);
            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> varsCaptor = ArgumentCaptor.forClass(Map.class);
            verify(taskBridge).onTaskCompleted(eq(task), varsCaptor.capture());
            assertEquals(true, varsCaptor.getValue().get("taskSuccess"));
        }

        @Test
        @DisplayName("TaskInstance TIMEOUT + waitActivityId 匹配 → 信号失败 (taskSuccess=false)")
        void timedOutTask_signalsFailure() throws Exception {
            String processInstanceId = "proc-002";
            String activityId = "reply_agent_wait";
            TaskInstance task = buildTaskInstance(102L, TaskStatus.TIMEOUT,
                    processInstanceId, activityId);

            when(taskInstanceRepository.findByPayloadContainingAndStatusIn(
                    eq(processInstanceId), eq(List.of(TaskStatus.COMPLETED, TaskStatus.TIMEOUT))))
                    .thenReturn(List.of(task));

            boolean recovered = scheduler.tryRecoverAgentReceiveTask(processInstanceId, activityId);

            assertTrue(recovered);
            @SuppressWarnings("unchecked")
            ArgumentCaptor<Map<String, Object>> varsCaptor = ArgumentCaptor.forClass(Map.class);
            verify(taskBridge).onTaskCompleted(eq(task), varsCaptor.capture());
            assertEquals(false, varsCaptor.getValue().get("taskSuccess"));
        }

        @Test
        @DisplayName("waitActivityId 不匹配 → 不触发桥接")
        void waitActivityIdMismatch_noAction() throws Exception {
            String processInstanceId = "proc-003";
            TaskInstance task = buildTaskInstance(103L, TaskStatus.COMPLETED,
                    processInstanceId, "reply_agent_wait");

            when(taskInstanceRepository.findByPayloadContainingAndStatusIn(
                    eq(processInstanceId), eq(List.of(TaskStatus.COMPLETED, TaskStatus.TIMEOUT))))
                    .thenReturn(List.of(task));

            boolean recovered = scheduler.tryRecoverAgentReceiveTask(processInstanceId, "translate_agent_wait");

            assertFalse(recovered);
            verifyNoInteractions(taskBridge);
        }

        @Test
        @DisplayName("无匹配 TaskInstance → 返回 false")
        void noMatchingTask_returnsFalse() {
            when(taskInstanceRepository.findByPayloadContainingAndStatusIn(
                    anyString(), anyList())).thenReturn(List.of());

            boolean recovered = scheduler.tryRecoverAgentReceiveTask("proc-empty", "translate_agent_wait");

            assertFalse(recovered);
            verifyNoInteractions(taskBridge);
        }

        @Test
        @DisplayName("桥接调用抛异常 → 不传播，返回 false")
        void bridgeThrows_doesNotPropagate() throws Exception {
            String processInstanceId = "proc-004";
            String activityId = "translate_agent_wait";
            TaskInstance task = buildTaskInstance(104L, TaskStatus.COMPLETED,
                    processInstanceId, activityId);

            when(taskInstanceRepository.findByPayloadContainingAndStatusIn(
                    eq(processInstanceId), anyList())).thenReturn(List.of(task));
            doThrow(new RuntimeException("桥接异常"))
                    .when(taskBridge).onTaskCompleted(any(), any());

            assertDoesNotThrow(() -> {
                boolean recovered = scheduler.tryRecoverAgentReceiveTask(processInstanceId, activityId);
                assertFalse(recovered);
            });
        }
    }

    // =========================================================================
    // handleStuckProcess — 集成场景
    // =========================================================================

    @Nested
    @DisplayName("handleStuckProcess — Agent + Human ReceiveTask")
    class IntegrationScenarios {

        @Test
        @DisplayName("Agent ReceiveTask 卡住且有 COMPLETED 任务 → 恢复成功")
        void agentReceiveTaskStuck_completedTask_recovers() throws Exception {
            ProcessInstance process = mockProcessInstance("proc-int-1", "bk-int-1",
                    Instant.now().minus(Duration.ofMinutes(60)));

            Execution agentExecution = mock(Execution.class);
            when(workflowService.findReceiveTaskExecution("proc-int-1", "translate_agent_wait"))
                    .thenReturn(agentExecution);

            TaskInstance task = buildTaskInstance(200L, TaskStatus.COMPLETED,
                    "proc-int-1", "translate_agent_wait");
            when(taskInstanceRepository.findByPayloadContainingAndStatusIn(
                    eq("proc-int-1"), anyList())).thenReturn(List.of(task));

            int result = scheduler.handleStuckProcess(process);

            assertEquals(1, result);
            verify(taskBridge).onTaskCompleted(eq(task), any());
        }

        @Test
        @DisplayName("Human ReceiveTask 卡住 → 仅日志，不恢复")
        void humanReceiveTaskStuck_noRecovery() {
            ProcessInstance process = mockProcessInstance("proc-int-2", "bk-int-2",
                    Instant.now().minus(Duration.ofMinutes(60)));

            when(workflowService.findReceiveTaskExecution(eq("proc-int-2"), eq("translate_agent_wait")))
                    .thenReturn(null);
            when(workflowService.findReceiveTaskExecution(eq("proc-int-2"), eq("reply_agent_wait")))
                    .thenReturn(null);

            Execution humanExecution = mock(Execution.class);
            when(workflowService.findReceiveTaskExecution("proc-int-2", "audit_create_wait"))
                    .thenReturn(humanExecution);

            int result = scheduler.handleStuckProcess(process);

            assertEquals(0, result);
            verifyNoInteractions(taskBridge, taskInstanceRepository);
        }

        @Test
        @DisplayName("无 ReceiveTask 卡住 → 返回 0")
        void noReceiveTaskStuck_returns0() {
            ProcessInstance process = mockProcessInstance("proc-int-3", "bk-int-3",
                    Instant.now().minus(Duration.ofMinutes(60)));

            when(workflowService.findReceiveTaskExecution(anyString(), anyString())).thenReturn(null);

            int result = scheduler.handleStuckProcess(process);

            assertEquals(0, result);
            verifyNoInteractions(taskBridge, taskInstanceRepository);
        }
    }

    // =========================================================================
    // extractWaitActivityId
    // =========================================================================

    @Nested
    @DisplayName("extractWaitActivityId")
    class ExtractWaitActivityId {

        @Test
        @DisplayName("有效 JSON → 提取 waitActivityId")
        void validJson_extractsActivityId() throws Exception {
            String payload = objectMapper.writeValueAsString(Map.of(
                    "processInstanceId", "proc-x",
                    "waitActivityId", "translate_agent_wait"));

            assertEquals("translate_agent_wait", scheduler.extractWaitActivityId(payload));
        }

        @Test
        @DisplayName("无 waitActivityId 字段 → 返回 null")
        void missingField_returnsNull() throws Exception {
            String payload = objectMapper.writeValueAsString(Map.of(
                    "processInstanceId", "proc-x"));

            assertNull(scheduler.extractWaitActivityId(payload));
        }

        @Test
        @DisplayName("null payload → 返回 null")
        void nullPayload_returnsNull() {
            assertNull(scheduler.extractWaitActivityId(null));
        }

        @Test
        @DisplayName("空 payload → 返回 null")
        void emptyPayload_returnsNull() {
            assertNull(scheduler.extractWaitActivityId("   "));
        }

        @Test
        @DisplayName("非法 JSON → 返回 null，不抛异常")
        void invalidJson_returnsNull() {
            assertDoesNotThrow(() -> {
                assertNull(scheduler.extractWaitActivityId("{invalid json}"));
            });
        }
    }

    // =========================================================================
    // 辅助方法
    // =========================================================================

    private ProcessInstance mockProcessInstance(String id, String businessKey, Instant startTime) {
        ProcessInstance process = mock(ProcessInstance.class);
        lenient().when(process.getId()).thenReturn(id);
        lenient().when(process.getBusinessKey()).thenReturn(businessKey);
        lenient().when(process.getStartTime()).thenReturn(Date.from(startTime));
        return process;
    }

    private TaskInstance buildTaskInstance(Long id, TaskStatus status,
                                           String processInstanceId, String waitActivityId) throws Exception {
        TaskInstance task = new TaskInstance();
        task.setId(id);
        task.setStatus(status);
        task.setPayload(objectMapper.writeValueAsString(Map.of(
                "processInstanceId", processInstanceId,
                "waitActivityId", waitActivityId,
                "agentCode", "test-agent",
                "businessKey", "bk-test"
        )));
        return task;
    }
}
