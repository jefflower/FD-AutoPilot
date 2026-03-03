package com.jefflower.fdserver.ai.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ai.dto.AgentExecuteResult;
import com.jefflower.fdserver.ai.dto.CapabilityRouteResult;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentInstance;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.enums.TriggerType;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.*;

/**
 * 同步 Agent 执行桥接服务。
 * <p>
 * 用于 n8n 等外部系统同步调用 CLIENT_ONLY Agent：
 * 1. 创建 TaskInstance（type=agent.{agentCode}）并注册 CompletableFuture
 * 2. 客户端通过 SSE+REST 轮询 claim 并执行 Agent
 * 3. 客户端 completeTask 触发 TaskCompletedEvent → SyncTaskCompletionListener → 此 Service.onTaskCompleted
 * 4. CompletableFuture 完成 → 返回 AgentExecuteResult
 * <p>
 * 断路器逻辑委托给 {@link CircuitBreakerService}，
 * Agent 环境解析委托给 {@link AgentExecutionEnvResolver}。
 */
@Slf4j
@Service
public class SyncAgentExecutionService {

    private final TaskDistributionService taskDistributionService;
    private final AgentExecutionEnvResolver envResolver;
    private final AgentConfigMerger agentConfigMerger;
    private final CircuitBreakerService circuitBreakerService;
    private final ObjectMapper objectMapper;

    /** 最大泄漏 Future 存活时间，默认 15 分钟，可通过 sync-bridge.max-future-age-ms 配置 */
    @Value("${sync-bridge.max-future-age-ms:900000}")
    private long maxFutureAgeMs;

    /** Future 池最大容量，默认 100，可通过 sync-bridge.max-pool-size 配置 */
    @Value("${sync-bridge.max-pool-size:100}")
    private int maxPoolSize;

    /**
     * 等待中的同步任务：taskInstanceId → WaitingFuture（含创建时间和业务上下文）
     */
    private final ConcurrentHashMap<Long, WaitingFuture> futureMap = new ConcurrentHashMap<>();

    /** 封装 CompletableFuture + 创建时间 + 业务上下文，用于超时清理、耗时统计和日志追踪 */
    private record WaitingFuture(CompletableFuture<AgentExecuteResult> future, Instant createdAt,
                                 String refType, String refId) {}

    public SyncAgentExecutionService(TaskDistributionService taskDistributionService,
                                     AgentExecutionEnvResolver envResolver,
                                     AgentConfigMerger agentConfigMerger,
                                     CircuitBreakerService circuitBreakerService,
                                     ObjectMapper objectMapper) {
        this.taskDistributionService = taskDistributionService;
        this.envResolver = envResolver;
        this.agentConfigMerger = agentConfigMerger;
        this.circuitBreakerService = circuitBreakerService;
        this.objectMapper = objectMapper;
    }

    /**
     * 同步执行客户端 Agent，阻塞等待结果返回。
     *
     * @param agentCode Agent 定义的 code（如 "gemini", "notebooklm"）
     * @param input     Agent 执行输入（完整的输入数据，含 prompt 等）
     * @param refType   关联业务类型（如 "ticket"）
     * @param refId     关联业务 ID
     * @param timeoutMs 超时时间（毫秒），推荐 300_000L（5分钟）
     * @return AgentExecuteResult 执行结果
     */
    public AgentExecuteResult executeSyncOnClient(String agentCode, Map<String, Object> input,
                                                   String refType, String refId,
                                                   long timeoutMs) {
        // 1. 校验 Agent 存在且可在客户端执行
        AgentDefinition agentDef = envResolver.validateForClientExecution(agentCode);

        // 2. 查找在线 AgentInstance 并合并配置
        AgentInstance onlineInstance = envResolver.findOnlineInstance(agentCode);

        // 三级配置合并：definition.agentConfig < instance.localConfig < runtimeParams(input)
        Map<String, Object> mergedConfig = agentConfigMerger.merge(agentDef, onlineInstance, null);

        // 3. 构建 payload JSON
        String payload = buildPayload(agentCode, input, mergedConfig);

        // 4. 创建 TaskInstance
        String taskType = "agent." + agentCode;
        TaskInstance task = taskDistributionService.createTask(
                taskType, refType, refId, payload, TriggerType.EVENT);

        // 5. 如果返回的任务已是终态（幂等返回），直接从 task.result 读取
        if (task.getStatus() == TaskStatus.COMPLETED) {
            log.info("SyncAgent: task {} already COMPLETED (idempotent), reading result", task.getId());
            return parseResultFromTask(task);
        }
        if (task.getStatus() == TaskStatus.FAILED || task.getStatus() == TaskStatus.CANCELLED
                || task.getStatus() == TaskStatus.TIMEOUT) {
            log.warn("SyncAgent: task {} in terminal status {}", task.getId(), task.getStatus());
            return new AgentExecuteResult(false, null, null,
                    "Task already in terminal status: " + task.getStatus());
        }

        // 6. 注册 Future 并等待结果
        return waitForResult(task.getId(), agentCode, null, refType, refId, timeoutMs, null);
    }

    /**
     * 通过 Capability 路由结果同步执行 Agent，阻塞等待客户端返回。
     * <p>
     * 与 executeSyncOnClient 类似，但使用预路由的 CapabilityRouteResult，
     * 直接从中获取 agentDef、agentInstance、targetClientId 等信息。
     *
     * @param route     Capability 路由结果
     * @param input     Agent 执行输入
     * @param refType   关联业务类型
     * @param refId     关联业务 ID
     * @param timeoutMs 超时时间（毫秒）
     * @return AgentExecuteResult 执行结果
     */
    public AgentExecuteResult executeSyncViaRoute(CapabilityRouteResult route, Map<String, Object> input,
                                                   String refType, String refId, long timeoutMs) {
        AgentDefinition agentDef = route.getAgentDefinition();
        AgentInstance agentInstance = route.getAgentInstance();
        String agentCode = route.getAgentCode();
        String targetClientId = route.getClientId();
        String capability = route.getRequiredCapability();

        // 路由审计日志
        log.info("[SyncBridge] 路由决策: capability={}, agentCode={}, clientId={}, userId={}, circuitState={}",
                route.getRequiredCapability(), route.getAgentCode(), route.getClientId(), route.getUserId(),
                getCircuitState(route.getRequiredCapability()));

        // 断路器检查
        if (capability != null) {
            circuitBreakerService.checkCircuitBreaker(capability);
        }

        // 三级配置合并：definition.agentConfig < instance.localConfig < runtimeParams(input)
        Map<String, Object> mergedConfig = agentConfigMerger.merge(agentDef, agentInstance, null);

        // 构建 payload JSON
        String payload = buildPayload(agentCode, input, mergedConfig);

        // 创建 TaskInstance（不锁定特定客户端，任何具备所需 Capability 的在线客户端均可 claim）
        String taskType = "agent." + agentCode;
        TaskInstance task = taskDistributionService.createTask(
                taskType, refType, refId, payload, TriggerType.EVENT,
                null, null);

        // 如果返回的任务已是终态（幂等返回），直接从 task.result 读取
        if (task.getStatus() == TaskStatus.COMPLETED) {
            log.info("SyncAgent(route): task {} already COMPLETED (idempotent), reading result", task.getId());
            circuitBreakerService.recordSuccess(capability);
            return parseResultFromTask(task);
        }
        if (task.getStatus() == TaskStatus.FAILED || task.getStatus() == TaskStatus.CANCELLED
                || task.getStatus() == TaskStatus.TIMEOUT) {
            log.warn("SyncAgent(route): task {} in terminal status {}", task.getId(), task.getStatus());
            circuitBreakerService.recordFailure(capability);
            return new AgentExecuteResult(false, null, null,
                    "Task already in terminal status: " + task.getStatus());
        }

        // 注册 Future 并等待结果
        return waitForResult(task.getId(), agentCode, targetClientId, refType, refId, timeoutMs, capability);
    }

    /**
     * 任务完成回调（由 SyncTaskCompletionListener 调用）。
     * 将结果写入对应的 CompletableFuture。
     */
    public void onTaskCompleted(Long taskId, boolean success, String resultOrError) {
        WaitingFuture waiting = futureMap.remove(taskId);
        if (waiting == null) {
            log.debug("SyncAgent: no waiting future for task {} (not a sync call or already timed out)", taskId);
            return;
        }

        long waitedMs = Instant.now().toEpochMilli() - waiting.createdAt.toEpochMilli();
        AgentExecuteResult result;
        if (success) {
            result = new AgentExecuteResult(true, resultOrError, null, null);
            log.info("SyncAgent: task {} completed successfully in {}ms, result length={}",
                    taskId, waitedMs, resultOrError != null ? resultOrError.length() : 0);
        } else {
            result = new AgentExecuteResult(false, null, null, resultOrError);
            log.warn("SyncAgent: task {} failed after {}ms: {}", taskId, waitedMs, resultOrError);
        }

        waiting.future.complete(result);
    }

    /**
     * 定期清理泄漏的 Future。
     * 每 5 分钟执行一次：
     * - 清理已完成的 Future（正常情况 finally 已清理，这是防御性措施）
     * - 主动超时注册超过 15 分钟的 Future（异常情况：调用线程异常退出未清理）
     */
    @Scheduled(fixedDelay = 300_000, initialDelay = 300_000)
    public void cleanupStaleFutures() {
        if (futureMap.isEmpty()) return;

        Instant now = Instant.now();
        Instant cutoff = now.minusMillis(maxFutureAgeMs);
        int[] counters = {0, 0}; // [cleanedDone, cleanedStale]

        futureMap.entrySet().removeIf(entry -> {
            WaitingFuture waiting = entry.getValue();
            if (waiting.future.isDone()) {
                counters[0]++;
                return true;
            } else if (waiting.createdAt.isBefore(cutoff)) {
                long waitedMs = now.toEpochMilli() - waiting.createdAt.toEpochMilli();
                log.warn("[SyncBridge] 清理过期 Future: taskId={}, waitedMs={}, refType={}, refId={}",
                        entry.getKey(), waitedMs, waiting.refType(), waiting.refId());
                // 主动超时：完成 Future
                waiting.future.complete(new AgentExecuteResult(false, null, null,
                        "Stale future cleaned up after " + maxFutureAgeMs + "ms"));
                cancelTimedOutTask(entry.getKey(), maxFutureAgeMs);
                counters[1]++;
                return true;
            }
            return false;
        });

        int cleanedDone = counters[0];
        int cleanedStale = counters[1];
        if (cleanedDone > 0 || cleanedStale > 0) {
            log.info("[SyncBridge] 本次清理了 {} 个过期 Future，当前剩余 {} 个 (done={}, stale={})",
                    cleanedDone + cleanedStale, futureMap.size(), cleanedDone, cleanedStale);
        }
    }

    /**
     * 获取当前等待中的 Future 数量（供监控使用）。
     */
    public int getActiveWaitingCount() {
        return futureMap.size();
    }

    /**
     * 获取指定 capability 的断路器状态。
     */
    public CircuitBreakerService.CircuitState getCircuitState(String capability) {
        return circuitBreakerService.getCircuitState(capability);
    }

    /**
     * 获取所有 capability 的断路器状态（供监控端点使用）。
     */
    public Map<String, Object> getCircuitBreakerStatus() {
        return circuitBreakerService.getCircuitBreakerStatus();
    }

    /**
     * 手动重置指定 capability 的断路器（恢复到 CLOSED 状态）。
     */
    public void resetCircuitBreaker(String capability) {
        circuitBreakerService.resetCircuitBreaker(capability);
    }

    /**
     * 获取 Sync Bridge 状态快照（供监控端点使用）。
     */
    public Map<String, Object> getStatusSnapshot() {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("activeWaiting", futureMap.size());
        snapshot.put("waitingTaskIds", futureMap.keySet().stream().toList());
        snapshot.put("circuitBreakers", getCircuitBreakerStatus());
        return snapshot;
    }

    // ======================== 内部方法 ========================

    /**
     * 构建 payload JSON。
     */
    private String buildPayload(String agentCode, Map<String, Object> input, Map<String, Object> mergedConfig) {
        try {
            Map<String, Object> payloadMap = new HashMap<>();
            payloadMap.put("agentCode", agentCode);
            payloadMap.put("agentInput", input);
            payloadMap.put("syncMode", true);
            if (!mergedConfig.isEmpty()) {
                payloadMap.put("mergedConfig", mergedConfig);
            }
            return objectMapper.writeValueAsString(payloadMap);
        } catch (Exception e) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR,
                    "Failed to serialize agent payload: " + e.getMessage());
        }
    }

    /**
     * 注册 CompletableFuture 并阻塞等待客户端执行结果。
     *
     * @param taskId         任务 ID
     * @param agentCode      Agent 编码
     * @param targetClientId 目标客户端（可为 null）
     * @param refType        关联业务类型
     * @param refId          关联业务 ID
     * @param timeoutMs      超时时间（毫秒）
     * @param capability     关联 capability（用于断路器，可为 null）
     * @return 执行结果
     */
    private AgentExecuteResult waitForResult(Long taskId, String agentCode, String targetClientId,
                                              String refType, String refId, long timeoutMs,
                                              String capability) {
        // 容量检查：防止 Future 池无限膨胀
        if (futureMap.size() >= maxPoolSize) {
            log.error("[SyncBridge] Future 池已满 (size={}), 拒绝新请求", futureMap.size());
            throw new BusinessException(ErrorCode.INTERNAL_ERROR,
                    "SyncBridge future pool is full (size=" + futureMap.size() + "), please retry later");
        }

        // 注册 CompletableFuture 等待结果
        CompletableFuture<AgentExecuteResult> future = new CompletableFuture<>();
        futureMap.put(taskId, new WaitingFuture(future, Instant.now(), refType, refId));

        String logPrefix = capability != null ? "SyncAgent(route)" : "SyncAgent";
        log.info("{}: waiting for task {} (agent={}, client={}, refType={}, refId={}), timeout={}ms, activeWaiting={}",
                logPrefix, taskId, agentCode, targetClientId, refType, refId, timeoutMs, futureMap.size());

        try {
            AgentExecuteResult result = future.get(timeoutMs, TimeUnit.MILLISECONDS);
            // 根据执行结果更新断路器
            if (capability != null) {
                if (result.isSuccess()) {
                    circuitBreakerService.recordSuccess(capability);
                } else {
                    circuitBreakerService.recordFailure(capability);
                }
            }
            return result;
        } catch (TimeoutException e) {
            log.warn("{}: task {} timed out after {}ms, marking task as FAILED", logPrefix, taskId, timeoutMs);
            if (capability != null) {
                circuitBreakerService.recordFailure(capability);
            }
            // 仅在 Future 未被其他线程完成时才 cancel 任务
            if (!future.isDone()) {
                cancelTimedOutTask(taskId, timeoutMs);
            }
            return new AgentExecuteResult(false, null, null,
                    "Agent execution timed out after " + timeoutMs + "ms (no client responded or execution too slow)");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("{}: task {} interrupted", logPrefix, taskId);
            if (capability != null) {
                circuitBreakerService.recordFailure(capability);
            }
            return new AgentExecuteResult(false, null, null, "Agent execution interrupted");
        } catch (ExecutionException e) {
            log.error("{}: task {} execution error", logPrefix, taskId, e.getCause());
            if (capability != null) {
                circuitBreakerService.recordFailure(capability);
            }
            return new AgentExecuteResult(false, null, null,
                    "Agent execution error: " + e.getCause().getMessage());
        } finally {
            futureMap.remove(taskId);
        }
    }

    /**
     * 超时后主动标记 TaskInstance 为 FAILED。
     */
    private void cancelTimedOutTask(Long taskId, long timeoutMs) {
        try {
            taskDistributionService.completeTask(taskId, null, false,
                    "Sync Bridge timeout after " + timeoutMs + "ms (no client responded)");
            log.info("SyncAgent: task {} marked as FAILED after timeout", taskId);
        } catch (Exception e) {
            // 任务可能已被客户端在超时临界点完成，忽略
            log.debug("SyncAgent: failed to cancel timed-out task {} (may already be completed): {}",
                    taskId, e.getMessage());
        }
    }

    /**
     * 从已完成的 TaskInstance 读取结果。
     */
    private AgentExecuteResult parseResultFromTask(TaskInstance task) {
        if (task.getStatus() == TaskStatus.COMPLETED) {
            return new AgentExecuteResult(true, task.getResult(), null, null);
        } else {
            return new AgentExecuteResult(false, null, null, task.getErrorMessage());
        }
    }
}
