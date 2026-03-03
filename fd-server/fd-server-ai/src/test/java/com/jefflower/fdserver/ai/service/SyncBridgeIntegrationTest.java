package com.jefflower.fdserver.ai.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ai.dto.AgentExecuteResult;
import com.jefflower.fdserver.ai.dto.CapabilityRouteResult;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentInstance;
import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.enums.TriggerType;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("SyncBridgeIntegrationTest - Sync Bridge 链路测试")
class SyncBridgeIntegrationTest {

    @Mock
    private TaskDistributionService taskDistributionService;

    @Mock
    private AgentExecutionEnvResolver envResolver;

    @Mock
    private AgentConfigMerger agentConfigMerger;

    @Mock
    private CircuitBreakerService circuitBreakerService;

    @InjectMocks
    private SyncAgentExecutionService syncAgentExecutionService;

    private final ObjectMapper realObjectMapper = new ObjectMapper();

    // --- 测试数据 ---
    private AgentDefinition agentDef;
    private AgentInstance agentInstance;
    private CapabilityDefinition capabilityDefinition;
    private TaskInstance pendingTask;

    @BeforeEach
    void setUp() throws Exception {
        // 使用真实 ObjectMapper 注入（SyncAgentExecutionService 需要序列化 payload）
        // 通过反射注入真实 ObjectMapper
        java.lang.reflect.Field objectMapperField = SyncAgentExecutionService.class.getDeclaredField("objectMapper");
        objectMapperField.setAccessible(true);
        objectMapperField.set(syncAgentExecutionService, realObjectMapper);

        // 注入 @Value 字段（Mockito @InjectMocks 不处理 @Value 注解）
        java.lang.reflect.Field maxPoolSizeField = SyncAgentExecutionService.class.getDeclaredField("maxPoolSize");
        maxPoolSizeField.setAccessible(true);
        maxPoolSizeField.setInt(syncAgentExecutionService, 100);

        java.lang.reflect.Field maxFutureAgeMsField = SyncAgentExecutionService.class.getDeclaredField("maxFutureAgeMs");
        maxFutureAgeMsField.setAccessible(true);
        maxFutureAgeMsField.setLong(syncAgentExecutionService, 900_000L);

        agentDef = new AgentDefinition();
        agentDef.setId(1L);
        agentDef.setCode("gemini-translate");
        agentDef.setName("Gemini 翻译");
        agentDef.setCapability("translation");
        agentDef.setRequiredCapability("gemini-cli");
        agentDef.setProviderType(ProviderType.GEMINI_CLI);
        agentDef.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        agentDef.setEnabled(true);
        agentDef.setAgentConfig("{\"model\":\"gemini-pro\"}");

        agentInstance = new AgentInstance();
        agentInstance.setId(10L);
        agentInstance.setClientId("client-001");
        agentInstance.setUserId("user-001");
        agentInstance.setAgentCode("gemini-translate");
        agentInstance.setRunning(true);
        agentInstance.setLocalConfig("{\"temperature\":\"0.7\"}");
        agentInstance.setLastHeartbeat(LocalDateTime.now().minusSeconds(10));

        capabilityDefinition = new CapabilityDefinition();
        capabilityDefinition.setId(100L);
        capabilityDefinition.setCode("gemini-cli");
        capabilityDefinition.setEnabled(true);

        pendingTask = new TaskInstance();
        pendingTask.setId(1001L);
        pendingTask.setTaskType("agent.gemini-translate");
        pendingTask.setStatus(TaskStatus.PENDING);
        pendingTask.setReferenceType("ticket");
        pendingTask.setReferenceId("42");
    }

    // ========== executeSyncViaRoute ==========

    @Nested
    @DisplayName("executeSyncViaRoute 正常流程场景")
    class ExecuteSyncViaRouteNormalTests {

        @Test
        @DisplayName("shouldCompleteSuccessfullyWhenClientCompletesTaskInTime - 客户端及时完成任务时正常返回")
        void shouldCompleteSuccessfullyWhenClientCompletesTaskInTime() throws Exception {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            Map<String, Object> input = Map.of("text", "Hello World");

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Map.of("model", "gemini-pro"));
            when(taskDistributionService.createTask(
                    eq("agent.gemini-translate"), eq("ticket"), eq("42"), any(String.class),
                    eq(TriggerType.EVENT), isNull(), isNull()))
                    .thenReturn(pendingTask);

            // 模拟客户端在 200ms 后完成任务
            ExecutorService executor = Executors.newSingleThreadExecutor();
            executor.submit(() -> {
                try {
                    Thread.sleep(200);
                    syncAgentExecutionService.onTaskCompleted(1001L, true, "翻译结果: 你好世界");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });

            AgentExecuteResult result = syncAgentExecutionService.executeSyncViaRoute(
                    route, input, "ticket", "42", 5000L);

            executor.shutdown();
            executor.awaitTermination(2, TimeUnit.SECONDS);

            assertNotNull(result);
            assertTrue(result.isSuccess());
            assertEquals("翻译结果: 你好世界", result.getOutput());
            assertNull(result.getErrorMessage());
        }

        @Test
        @DisplayName("shouldRegisterFutureAndReturnResultOnCallback - Future 注册后通过 onTaskCompleted 回调返回结果")
        void shouldRegisterFutureAndReturnResultOnCallback() throws Exception {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), anyString(),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(pendingTask);

            // 异步触发回调（成功）
            ExecutorService executor = Executors.newSingleThreadExecutor();
            executor.submit(() -> {
                try {
                    Thread.sleep(100);
                    syncAgentExecutionService.onTaskCompleted(1001L, true, "success output");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });

            AgentExecuteResult result = syncAgentExecutionService.executeSyncViaRoute(
                    route, Map.of("prompt", "test"), "n8n", "job-1", 5000L);

            executor.shutdown();
            executor.awaitTermination(2, TimeUnit.SECONDS);

            assertTrue(result.isSuccess());
            assertEquals("success output", result.getOutput());
            // 完成后 future 应从 map 中清除，activeWaiting 应为 0
            assertEquals(0, syncAgentExecutionService.getActiveWaitingCount());
        }

        @Test
        @DisplayName("shouldReturnFailureResultWhenClientReportsFailure - 客户端报告失败时返回失败结果")
        void shouldReturnFailureResultWhenClientReportsFailure() throws Exception {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), anyString(),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(pendingTask);

            ExecutorService executor = Executors.newSingleThreadExecutor();
            executor.submit(() -> {
                try {
                    Thread.sleep(100);
                    syncAgentExecutionService.onTaskCompleted(1001L, false, "执行失败: 模型超限");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });

            AgentExecuteResult result = syncAgentExecutionService.executeSyncViaRoute(
                    route, Map.of("prompt", "test"), "n8n", "job-1", 5000L);

            executor.shutdown();
            executor.awaitTermination(2, TimeUnit.SECONDS);

            assertFalse(result.isSuccess());
            assertNull(result.getOutput());
            assertEquals("执行失败: 模型超限", result.getErrorMessage());
        }

        @Test
        @DisplayName("shouldReturnImmediatelyWhenTaskAlreadyCompleted - 任务已完成时立即返回结果")
        void shouldReturnImmediatelyWhenTaskAlreadyCompleted() {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            // 任务已是 COMPLETED 终态
            TaskInstance completedTask = new TaskInstance();
            completedTask.setId(2001L);
            completedTask.setTaskType("agent.gemini-translate");
            completedTask.setStatus(TaskStatus.COMPLETED);
            completedTask.setResult("已有的翻译结果");

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), anyString(),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(completedTask);

            AgentExecuteResult result = syncAgentExecutionService.executeSyncViaRoute(
                    route, Map.of("text", "test"), "ticket", "1", 5000L);

            assertTrue(result.isSuccess());
            assertEquals("已有的翻译结果", result.getOutput());
            // 已完成的任务不需要注册 Future
            assertEquals(0, syncAgentExecutionService.getActiveWaitingCount());
        }

        @Test
        @DisplayName("shouldReturnTerminalStatusResultWhenTaskInFailedState - 任务已在失败终态时直接返回")
        void shouldReturnTerminalStatusResultWhenTaskInFailedState() {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            TaskInstance failedTask = new TaskInstance();
            failedTask.setId(3001L);
            failedTask.setTaskType("agent.gemini-translate");
            failedTask.setStatus(TaskStatus.FAILED);
            failedTask.setErrorMessage("历史失败原因");

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), anyString(),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(failedTask);

            AgentExecuteResult result = syncAgentExecutionService.executeSyncViaRoute(
                    route, Map.of("text", "test"), "ticket", "1", 5000L);

            assertFalse(result.isSuccess());
            assertTrue(result.getErrorMessage().contains("FAILED"));
            assertEquals(0, syncAgentExecutionService.getActiveWaitingCount());
        }
    }

    @Nested
    @DisplayName("executeSyncViaRoute 超时场景")
    class ExecuteSyncViaRouteTimeoutTests {

        @Test
        @DisplayName("shouldReturnTimeoutResultWhenClientDoesNotRespondInTime - 客户端超时未响应时返回超时结果")
        void shouldReturnTimeoutResultWhenClientDoesNotRespondInTime() {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), anyString(),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(pendingTask);
            doNothing().when(taskDistributionService).completeTask(anyLong(), isNull(), eq(false), anyString());

            // 使用 200ms 超时（不触发客户端回调）
            AgentExecuteResult result = syncAgentExecutionService.executeSyncViaRoute(
                    route, Map.of("text", "test"), "ticket", "42", 200L);

            assertFalse(result.isSuccess());
            assertNotNull(result.getErrorMessage());
            assertTrue(result.getErrorMessage().contains("timed out"),
                    "超时错误信息应包含 'timed out'，实际: " + result.getErrorMessage());

            // 超时后应调用 cancelTimedOutTask（通过 completeTask 实现）
            verify(taskDistributionService).completeTask(
                    eq(1001L), isNull(), eq(false), contains("Sync Bridge timeout"));

            // 超时后 future 应从 map 中清除
            assertEquals(0, syncAgentExecutionService.getActiveWaitingCount());
        }

        @Test
        @DisplayName("shouldCleanupFutureAfterTimeoutEvenIfCancelTaskFails - 取消任务失败时也应清理 Future")
        void shouldCleanupFutureAfterTimeoutEvenIfCancelTaskFails() {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), anyString(),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(pendingTask);
            // 模拟 cancelTimedOutTask 抛异常（任务已被客户端在临界点完成）
            doThrow(new RuntimeException("任务已完成，无法取消"))
                    .when(taskDistributionService).completeTask(anyLong(), isNull(), eq(false), anyString());

            AgentExecuteResult result = syncAgentExecutionService.executeSyncViaRoute(
                    route, Map.of("text", "test"), "ticket", "42", 200L);

            assertFalse(result.isSuccess());
            // 即使 cancelTask 失败，finally 也应清理 future
            assertEquals(0, syncAgentExecutionService.getActiveWaitingCount());
        }
    }

    @Nested
    @DisplayName("onTaskCompleted 回调场景")
    class OnTaskCompletedCallbackTests {

        @Test
        @DisplayName("shouldIgnoreCallbackWhenNoWaitingFutureExists - 无等待 Future 时静默忽略回调")
        void shouldIgnoreCallbackWhenNoWaitingFutureExists() {
            // 没有任何等待的 Future，调用回调不应抛异常
            assertDoesNotThrow(() -> syncAgentExecutionService.onTaskCompleted(9999L, true, "result"));
            assertEquals(0, syncAgentExecutionService.getActiveWaitingCount());
        }

        @Test
        @DisplayName("shouldCompleteSuccessFutureWhenOnTaskCompletedWithSuccess - 成功回调完成 Future")
        void shouldCompleteSuccessFutureWhenOnTaskCompletedWithSuccess() throws Exception {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), anyString(),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(pendingTask);

            CompletableFuture<AgentExecuteResult> resultFuture = CompletableFuture.supplyAsync(() -> {
                try {
                    return syncAgentExecutionService.executeSyncViaRoute(
                            route, Map.of(), "n8n", "1", 5000L);
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            });

            // 等待任务注册后发送成功回调
            Thread.sleep(100);
            syncAgentExecutionService.onTaskCompleted(1001L, true, "callback result");

            AgentExecuteResult result = resultFuture.get(3, TimeUnit.SECONDS);
            assertTrue(result.isSuccess());
            assertEquals("callback result", result.getOutput());
        }

        @Test
        @DisplayName("shouldCompleteFailureFutureWhenOnTaskCompletedWithFailure - 失败回调完成 Future")
        void shouldCompleteFailureFutureWhenOnTaskCompletedWithFailure() throws Exception {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), anyString(),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(pendingTask);

            CompletableFuture<AgentExecuteResult> resultFuture = CompletableFuture.supplyAsync(() -> {
                try {
                    return syncAgentExecutionService.executeSyncViaRoute(
                            route, Map.of(), "n8n", "1", 5000L);
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            });

            Thread.sleep(100);
            syncAgentExecutionService.onTaskCompleted(1001L, false, "执行错误原因");

            AgentExecuteResult result = resultFuture.get(3, TimeUnit.SECONDS);
            assertFalse(result.isSuccess());
            assertEquals("执行错误原因", result.getErrorMessage());
        }
    }

    @Nested
    @DisplayName("配置合并优先级场景")
    class ConfigMergePriorityTests {

        @Test
        @DisplayName("shouldPassCorrectAgentAndInstanceToMerger - 正确传入 agentDef 和 agentInstance 给合并器")
        void shouldPassCorrectAgentAndInstanceToMerger() throws Exception {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), anyString(),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(pendingTask);

            ExecutorService executor = Executors.newSingleThreadExecutor();
            executor.submit(() -> {
                try {
                    Thread.sleep(100);
                    syncAgentExecutionService.onTaskCompleted(1001L, true, "ok");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });

            syncAgentExecutionService.executeSyncViaRoute(
                    route, Map.of("text", "test"), "ticket", "1", 5000L);

            executor.shutdown();
            executor.awaitTermination(2, TimeUnit.SECONDS);

            // 验证合并器被调用时传入了正确的 agentDef 和 agentInstance
            ArgumentCaptor<AgentDefinition> defCaptor = ArgumentCaptor.forClass(AgentDefinition.class);
            ArgumentCaptor<AgentInstance> instanceCaptor = ArgumentCaptor.forClass(AgentInstance.class);
            verify(agentConfigMerger).merge(defCaptor.capture(), instanceCaptor.capture(), isNull());

            assertEquals("gemini-translate", defCaptor.getValue().getCode());
            assertEquals("client-001", instanceCaptor.getValue().getClientId());
        }

        @Test
        @DisplayName("shouldIncludeMergedConfigInPayloadWhenConfigNotEmpty - 合并后配置非空时包含在 payload 中")
        void shouldIncludeMergedConfigInPayloadWhenConfigNotEmpty() throws Exception {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            // 合并器返回非空配置（definition < instance 的合并结果）
            Map<String, Object> mergedConfig = Map.of("model", "gemini-pro", "temperature", "0.7");
            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(mergedConfig);
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), any(String.class),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(pendingTask);

            ExecutorService executor = Executors.newSingleThreadExecutor();
            executor.submit(() -> {
                try {
                    Thread.sleep(100);
                    syncAgentExecutionService.onTaskCompleted(1001L, true, "ok");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });

            syncAgentExecutionService.executeSyncViaRoute(
                    route, Map.of("text", "test"), "ticket", "1", 5000L);

            executor.shutdown();
            executor.awaitTermination(2, TimeUnit.SECONDS);

            // 验证 createTask 被调用时 payload 包含 mergedConfig
            ArgumentCaptor<String> payloadCaptor = ArgumentCaptor.forClass(String.class);
            verify(taskDistributionService).createTask(
                    anyString(), anyString(), anyString(), payloadCaptor.capture(),
                    any(TriggerType.class), isNull(), isNull());
            String payload = payloadCaptor.getValue();
            assertTrue(payload.contains("mergedConfig"), "payload 应包含 mergedConfig 键");
            assertTrue(payload.contains("gemini-pro"), "payload 应包含 model 配置值");
        }

        @Test
        @DisplayName("shouldNotIncludeMergedConfigInPayloadWhenConfigEmpty - 合并后配置为空时不包含 mergedConfig 键")
        void shouldNotIncludeMergedConfigInPayloadWhenConfigEmpty() throws Exception {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), any(String.class),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(pendingTask);

            ExecutorService executor = Executors.newSingleThreadExecutor();
            executor.submit(() -> {
                try {
                    Thread.sleep(100);
                    syncAgentExecutionService.onTaskCompleted(1001L, true, "ok");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });

            syncAgentExecutionService.executeSyncViaRoute(
                    route, Map.of("text", "test"), "ticket", "1", 5000L);

            executor.shutdown();
            executor.awaitTermination(2, TimeUnit.SECONDS);

            ArgumentCaptor<String> payloadCaptor = ArgumentCaptor.forClass(String.class);
            verify(taskDistributionService).createTask(
                    anyString(), anyString(), anyString(), payloadCaptor.capture(),
                    any(TriggerType.class), isNull(), isNull());
            String payload = payloadCaptor.getValue();
            assertFalse(payload.contains("mergedConfig"), "合并配置为空时不应包含 mergedConfig 键");
        }

        @Test
        @DisplayName("shouldPassNullTargetClientIdToCreateTask - createTask 应携带 null targetClientId 参数")
        void shouldPassNullTargetClientIdToCreateTask() throws Exception {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), anyString(),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(pendingTask);

            ExecutorService executor = Executors.newSingleThreadExecutor();
            executor.submit(() -> {
                try {
                    Thread.sleep(100);
                    syncAgentExecutionService.onTaskCompleted(1001L, true, "ok");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });

            syncAgentExecutionService.executeSyncViaRoute(
                    route, Map.of(), "ticket", "1", 5000L);

            executor.shutdown();
            executor.awaitTermination(2, TimeUnit.SECONDS);

            // 验证 createTask 接收了 null 的 targetClientId 和 targetUserId
            // （executeSyncViaRoute 中默认传 null, null 表示不限定客户端路由）
            verify(taskDistributionService).createTask(
                    eq("agent.gemini-translate"),
                    eq("ticket"),
                    eq("1"),
                    anyString(),
                    eq(TriggerType.EVENT),
                    isNull(),   // targetClientId
                    isNull()    // targetUserId
            );
        }
    }

    @Nested
    @DisplayName("cleanupStaleFutures 清理场景")
    class CleanupStaleFuturesTests {

        @Test
        @DisplayName("shouldReportZeroActiveWaitingWhenNoFuturesRegistered - 无 Future 注册时 activeWaiting 为 0")
        void shouldReportZeroActiveWaitingWhenNoFuturesRegistered() {
            assertEquals(0, syncAgentExecutionService.getActiveWaitingCount());
        }

        @Test
        @DisplayName("shouldDecrementActiveWaitingAfterFutureCompleted - Future 完成后 activeWaiting 减少")
        void shouldDecrementActiveWaitingAfterFutureCompleted() throws Exception {
            CapabilityRouteResult route = new CapabilityRouteResult(
                    "gemini-translate", "client-001", "user-001", "gemini-cli",
                    agentDef, agentInstance);

            when(agentConfigMerger.merge(any(), any(), isNull())).thenReturn(Collections.emptyMap());
            when(taskDistributionService.createTask(
                    anyString(), anyString(), anyString(), anyString(),
                    any(TriggerType.class), isNull(), isNull()))
                    .thenReturn(pendingTask);

            // 在另一个线程中执行（避免阻塞主线程）
            CompletableFuture<AgentExecuteResult> execFuture = CompletableFuture.supplyAsync(() ->
                    syncAgentExecutionService.executeSyncViaRoute(
                            route, Map.of(), "n8n", "1", 5000L));

            // 稍等，确保 Future 已注册
            Thread.sleep(150);
            assertEquals(1, syncAgentExecutionService.getActiveWaitingCount(),
                    "等待期间 activeWaiting 应为 1");

            // 触发完成
            syncAgentExecutionService.onTaskCompleted(1001L, true, "done");
            execFuture.get(3, TimeUnit.SECONDS);

            assertEquals(0, syncAgentExecutionService.getActiveWaitingCount(),
                    "完成后 activeWaiting 应为 0");
        }

        @Test
        @DisplayName("shouldProvideStatusSnapshotWithActiveWaiting - getStatusSnapshot 返回正确的 activeWaiting")
        void shouldProvideStatusSnapshotWithActiveWaiting() {
            Map<String, Object> snapshot = syncAgentExecutionService.getStatusSnapshot();

            assertNotNull(snapshot);
            assertTrue(snapshot.containsKey("activeWaiting"));
            assertTrue(snapshot.containsKey("waitingTaskIds"));
            assertEquals(0, snapshot.get("activeWaiting"));
        }
    }

    @Nested
    @DisplayName("AgentConfigMerger 三级配置合并")
    class AgentConfigMergerTests {

        // AgentConfigMerger 是独立组件，使用真实实例而非 Mock 直接测试
        private final AgentConfigMerger realMerger = new AgentConfigMerger();

        @Test
        @DisplayName("shouldMergeDefinitionConfigAsBaseLayer - agentConfig 作为基础层")
        void shouldMergeDefinitionConfigAsBaseLayer() {
            AgentDefinition def = new AgentDefinition();
            def.setAgentConfig("{\"model\":\"gemini-pro\",\"temperature\":\"0.5\"}");

            Map<String, Object> result = realMerger.merge(def, null, null);

            assertEquals("gemini-pro", result.get("model"));
            assertEquals("0.5", result.get("temperature"));
        }

        @Test
        @DisplayName("shouldOverrideDefinitionConfigWithInstanceLocalConfig - instance.localConfig 覆盖 definition.agentConfig")
        void shouldOverrideDefinitionConfigWithInstanceLocalConfig() {
            AgentDefinition def = new AgentDefinition();
            def.setAgentConfig("{\"model\":\"gemini-pro\",\"temperature\":\"0.5\"}");

            AgentInstance instance = new AgentInstance();
            instance.setLocalConfig("{\"temperature\":\"0.9\",\"maxTokens\":\"2000\"}");

            Map<String, Object> result = realMerger.merge(def, instance, null);

            assertEquals("gemini-pro", result.get("model"), "definition 中的 model 应保留");
            assertEquals("0.9", result.get("temperature"), "instance 中的 temperature 应覆盖 definition");
            assertEquals("2000", result.get("maxTokens"), "instance 中的 maxTokens 应新增");
        }

        @Test
        @DisplayName("shouldOverrideAllLowerLayersWithRuntimeParams - runtimeParams 覆盖所有低优先级配置")
        void shouldOverrideAllLowerLayersWithRuntimeParams() {
            AgentDefinition def = new AgentDefinition();
            def.setAgentConfig("{\"model\":\"gemini-pro\",\"temperature\":\"0.5\"}");

            AgentInstance instance = new AgentInstance();
            instance.setLocalConfig("{\"temperature\":\"0.9\",\"maxTokens\":\"2000\"}");

            Map<String, Object> runtimeParams = Map.of(
                    "temperature", "1.0",    // 覆盖 instance 的 0.9
                    "prompt", "runtime-prompt"  // 新增
            );

            Map<String, Object> result = realMerger.merge(def, instance, runtimeParams);

            assertEquals("gemini-pro", result.get("model"), "definition model 保留");
            assertEquals("1.0", result.get("temperature"), "runtimeParams 应以最高优先级覆盖");
            assertEquals("2000", result.get("maxTokens"), "instance maxTokens 保留");
            assertEquals("runtime-prompt", result.get("prompt"), "runtime prompt 新增");
        }

        @Test
        @DisplayName("shouldReturnEmptyMapWhenAllConfigsAreNull - 全为 null 时返回空 Map")
        void shouldReturnEmptyMapWhenAllConfigsAreNull() {
            AgentDefinition def = new AgentDefinition();
            def.setAgentConfig(null);

            Map<String, Object> result = realMerger.merge(def, null, null);

            assertNotNull(result);
            assertTrue(result.isEmpty());
        }

        @Test
        @DisplayName("shouldSkipInstanceLayerWhenInstanceIsNull - instance 为 null 时跳过 localConfig 层")
        void shouldSkipInstanceLayerWhenInstanceIsNull() {
            AgentDefinition def = new AgentDefinition();
            def.setAgentConfig("{\"model\":\"base-model\"}");

            Map<String, Object> result = realMerger.merge(def, null, null);

            assertEquals("base-model", result.get("model"));
            assertEquals(1, result.size());
        }

        @Test
        @DisplayName("shouldHandleInvalidJsonGracefully - 无效 JSON 配置时优雅处理（返回空层）")
        void shouldHandleInvalidJsonGracefully() {
            AgentDefinition def = new AgentDefinition();
            def.setAgentConfig("invalid-json-{{");

            AgentInstance instance = new AgentInstance();
            instance.setLocalConfig("{\"validKey\":\"validValue\"}");

            // 无效 JSON 不应抛异常，无效层被跳过
            Map<String, Object> result = realMerger.merge(def, instance, null);

            assertNotNull(result);
            // invalid agentConfig 被跳过，只有 localConfig 生效
            assertEquals("validValue", result.get("validKey"));
        }
    }
}
