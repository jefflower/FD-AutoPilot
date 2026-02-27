package com.jefflower.fdserver.workflow.listener;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.task.entity.TaskDefinition;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.event.TaskCompletedEvent;
import com.jefflower.fdserver.task.event.TaskPushEvent;
import com.jefflower.fdserver.task.repository.TaskDefinitionRepository;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import com.jefflower.fdserver.workflow.service.WorkflowTaskBridge;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class WorkflowTaskCompletionListenerTest {

    @Mock
    private WorkflowTaskBridge bridge;
    @Mock
    private TaskInstanceRepository taskInstanceRepository;
    @Mock
    private TaskDefinitionRepository taskDefinitionRepository;
    @Mock
    private ApplicationEventPublisher eventPublisher;

    private WorkflowTaskCompletionListener listener;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        listener = new WorkflowTaskCompletionListener(bridge, taskInstanceRepository, taskDefinitionRepository, eventPublisher);
    }

    // ========== 成功路径 ==========

    @Test
    void onTaskCompleted_success_bridgesToWorkflow() throws Exception {
        // given
        TaskInstance task = createTaskWithPayload("proc-1", "wait-1");
        when(taskInstanceRepository.findById(100L)).thenReturn(Optional.of(task));

        TaskCompletedEvent event = new TaskCompletedEvent(this, 100L, "ticket.translate", true, "client-1");

        // when
        listener.onTaskCompleted(event);

        // then
        verify(bridge).onTaskCompleted(eq(task), argThat(m -> Boolean.TRUE.equals(m.get("taskSuccess"))));
    }

    @Test
    void onTaskCompleted_success_noPayload_skips() {
        // given
        TaskInstance task = new TaskInstance();
        task.setId(100L);
        task.setPayload(null);
        when(taskInstanceRepository.findById(100L)).thenReturn(Optional.of(task));

        TaskCompletedEvent event = new TaskCompletedEvent(this, 100L, "ticket.translate", true, "client-1");

        // when
        listener.onTaskCompleted(event);

        // then
        verifyNoInteractions(bridge);
    }

    // ========== 失败路径 — 重试 ==========

    @Test
    void onTaskCompleted_failed_underRetryLimit_resetsToPending() throws Exception {
        // given
        TaskInstance task = createTaskWithPayload("proc-1", "wait-1");
        task.setRetryCount(0);
        task.setStatus(TaskStatus.FAILED);
        when(taskInstanceRepository.findById(100L)).thenReturn(Optional.of(task));

        TaskDefinition def = new TaskDefinition();
        def.setMaxRetries(3);
        when(taskDefinitionRepository.findByCode("ticket.translate")).thenReturn(Optional.of(def));

        TaskCompletedEvent event = new TaskCompletedEvent(this, 100L, "ticket.translate", false, "client-1", "Agent failed");

        // when
        listener.onTaskCompleted(event);

        // then — 重置为 PENDING
        assertEquals(TaskStatus.PENDING, task.getStatus());
        assertEquals(1, task.getRetryCount());
        assertNull(task.getAssignedTo());
        assertEquals("Agent failed", task.getErrorMessage());
        verify(taskInstanceRepository).save(task);

        // then — 不调用 bridge（等待重试）
        verifyNoInteractions(bridge);

        // then — 发布 TaskPushEvent 通知客户端重新领取
        verify(eventPublisher).publishEvent(any(TaskPushEvent.class));
    }

    @Test
    void onTaskCompleted_failed_atRetryLimit_signalsWorkflowFailure() throws Exception {
        // given
        TaskInstance task = createTaskWithPayload("proc-1", "wait-1");
        task.setRetryCount(3); // 已达上限
        task.setStatus(TaskStatus.FAILED);
        when(taskInstanceRepository.findById(100L)).thenReturn(Optional.of(task));

        TaskDefinition def = new TaskDefinition();
        def.setMaxRetries(3);
        when(taskDefinitionRepository.findByCode("ticket.translate")).thenReturn(Optional.of(def));

        TaskCompletedEvent event = new TaskCompletedEvent(this, 100L, "ticket.translate", false, "client-1", "Permanent failure");

        // when
        listener.onTaskCompleted(event);

        // then — 标记为 TIMEOUT
        assertEquals(TaskStatus.TIMEOUT, task.getStatus());
        assertNotNull(task.getCompletedAt());
        assertTrue(task.getErrorMessage().contains("Exceeded max retries"));
        verify(taskInstanceRepository).save(task);

        // then — signal workflow 传入 taskSuccess=false
        ArgumentCaptor<Map<String, Object>> varsCaptor = ArgumentCaptor.forClass(Map.class);
        verify(bridge).onTaskCompleted(eq(task), varsCaptor.capture());
        assertEquals(false, varsCaptor.getValue().get("taskSuccess"));
    }

    @Test
    void onTaskCompleted_failed_noTaskDefinition_usesDefaultMaxRetries() throws Exception {
        // given — TaskDefinition 不存在，使用默认 maxRetries=3
        TaskInstance task = createTaskWithPayload("proc-1", "wait-1");
        task.setRetryCount(0);
        when(taskInstanceRepository.findById(100L)).thenReturn(Optional.of(task));
        when(taskDefinitionRepository.findByCode("ticket.translate")).thenReturn(Optional.empty());

        TaskCompletedEvent event = new TaskCompletedEvent(this, 100L, "ticket.translate", false, "client-1", "error");

        // when
        listener.onTaskCompleted(event);

        // then — 使用默认 3 次重试，retryCount=0 < 3，所以重置为 PENDING
        assertEquals(TaskStatus.PENDING, task.getStatus());
        assertEquals(1, task.getRetryCount());
    }

    @Test
    void onTaskCompleted_failed_taskNotFound_noException() {
        // given
        when(taskInstanceRepository.findById(999L)).thenReturn(Optional.empty());

        TaskCompletedEvent event = new TaskCompletedEvent(this, 999L, "ticket.translate", false, "client-1", "error");

        // when / then — 不抛异常
        assertDoesNotThrow(() -> listener.onTaskCompleted(event));
        verifyNoInteractions(bridge);
    }

    @Test
    void onTaskCompleted_failed_noWorkflowPayload_noSignal() {
        // given — 任务没有 processInstanceId，超限时也不 signal
        TaskInstance task = new TaskInstance();
        task.setId(100L);
        task.setTaskType("ticket.translate");
        task.setPayload("{\"someField\": \"value\"}");
        task.setRetryCount(3);
        when(taskInstanceRepository.findById(100L)).thenReturn(Optional.of(task));

        TaskDefinition def = new TaskDefinition();
        def.setMaxRetries(3);
        when(taskDefinitionRepository.findByCode("ticket.translate")).thenReturn(Optional.of(def));

        TaskCompletedEvent event = new TaskCompletedEvent(this, 100L, "ticket.translate", false, "client-1", "error");

        // when
        listener.onTaskCompleted(event);

        // then — TIMEOUT 但不 signal（没有 processInstanceId）
        assertEquals(TaskStatus.TIMEOUT, task.getStatus());
        verifyNoInteractions(bridge);
    }

    // ========== 辅助方法 ==========

    private TaskInstance createTaskWithPayload(String processInstanceId, String waitActivityId) {
        try {
            TaskInstance task = new TaskInstance();
            task.setId(100L);
            task.setTaskType("ticket.translate");
            task.setReferenceType("ticket");
            task.setReferenceId("42");
            task.setPayload(objectMapper.writeValueAsString(Map.of(
                    "processInstanceId", processInstanceId,
                    "waitActivityId", waitActivityId
            )));
            return task;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
