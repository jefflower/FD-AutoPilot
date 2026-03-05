package com.jefflower.fdserver.config;

import com.jefflower.fdserver.ai.dto.AgentExecuteResult;
import com.jefflower.fdserver.ai.dto.CapabilityExecuteRequest;
import com.jefflower.fdserver.ai.dto.CapabilityExecuteResponse;
import com.jefflower.fdserver.ai.dto.CapabilityRouteResult;
import com.jefflower.fdserver.ai.entity.AgentExecution;
import com.jefflower.fdserver.ai.service.AgentDefinitionService;
import com.jefflower.fdserver.ai.service.AgentExecutionService;
import com.jefflower.fdserver.ai.service.CapabilityDefinitionService;
import com.jefflower.fdserver.ai.service.CapabilityRouterService;
import com.jefflower.fdserver.ai.service.SyncAgentExecutionService;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * n8n Capability 级执行控制器。
 * <p>
 * 提供 Capability 级路由的同步执行端点，n8n 通过业务 capability（如 "ticket-translate", "ticket-reply"）
 * 调用，系统自动路由到可用的 Agent + Client。
 * <p>
 * 同时保留旧的 agentCode 直连端点以兼容过渡期。
 */
@Tag(name = "n8n Agent 执行", description = "Capability 级路由 + Agent 同步执行接口，供 n8n 工作流节点调用")
@Slf4j
@RestController
@RequestMapping("/api/v1/n8n")
@RequiredArgsConstructor
public class N8nAgentController {

    private final SyncAgentExecutionService syncAgentService;
    private final AgentExecutionService agentExecutionService;
    private final CapabilityRouterService capabilityRouter;
    private final CapabilityDefinitionService capabilityDefinitionService;
    private final AgentDefinitionService agentDefinitionService;
    private final TicketRepository ticketRepository;
    private final ObjectMapper objectMapper;

    private static final long DEFAULT_TIMEOUT_MS = 600_000L; // 10 分钟

    @Operation(summary = "Capability 级同步执行",
            description = "通过业务 capability 路由到可用 Agent + Client，创建任务并等待执行完成。")
    @PostMapping("/capabilities/{capability}/execute")
    @RequiresPermission("ai:execute")
    public ResponseEntity<ApiResponse<CapabilityExecuteResponse>> executeCapability(
            @PathVariable String capability,
            @RequestBody CapabilityExecuteRequest request) {

        log.info("[N8nAgentController] Execute capability={}, refType={}, refId={}, targetClient={}, targetUser={}",
                capability, request.getRefType(), request.getRefId(),
                request.getTargetClientId(), request.getTargetUserId());

        // 0. 当 refType=ticket 时，将 externalId 解析为本地数据库 ID
        //    n8n 传入的 refId 通常是 Freshdesk 外部工单号，前端消费者需要本地 ID 来查询工单
        Map<String, Object> input = request.getInput() != null ? new HashMap<>(request.getInput()) : new HashMap<>();
        String refId = request.getRefId();

        if ("ticket".equals(request.getRefType()) && refId != null) {
            Ticket ticket = ticketRepository.findByExternalId(refId).orElse(null);
            if (ticket != null) {
                input.put("ticketId", ticket.getId());
                input.put("externalId", refId);
                input.put("subject", ticket.getSubject());
                refId = String.valueOf(ticket.getId());
                log.info("[N8nAgentController] Resolved ticket externalId={} → localId={}", request.getRefId(), ticket.getId());
            } else {
                log.warn("[N8nAgentController] Ticket not found by externalId={}, using raw refId", refId);
            }
        }

        // 1. 路由
        CapabilityRouteResult route = capabilityRouter.route(
                capability, request.getTargetClientId(), request.getTargetUserId());

        // 2. 记录执行开始
        Long refIdLong = null;
        try {
            if (refId != null) {
                refIdLong = Long.parseLong(refId);
            }
        } catch (NumberFormatException e) {
            log.warn("[N8nAgentController] refId '{}' 无法转为 Long，executionRecord.referenceId 将为 null", refId);
        }

        String inputJson = serializeInput(input);
        AgentExecution execution = agentExecutionService.startExecution(
                route.getAgentCode(), request.getRefType(), refIdLong,
                "n8n", route.getClientId(), inputJson);
        long startTime = System.currentTimeMillis();

        // 3. 执行
        long timeoutMs = request.getTimeoutMs() != null ? request.getTimeoutMs() : DEFAULT_TIMEOUT_MS;
        AgentExecuteResult result;
        try {
            result = syncAgentService.executeSyncViaRoute(
                    route, input,
                    request.getRefType(), refId, timeoutMs);
        } catch (Exception e) {
            // 异常时记录失败
            long duration = System.currentTimeMillis() - startTime;
            agentExecutionService.completeExecution(
                    execution.getId(), false, duration, null, null, e.getMessage());
            throw e;
        }

        // 4. 记录执行完成
        long duration = System.currentTimeMillis() - startTime;
        agentExecutionService.completeExecution(
                execution.getId(), result.isSuccess(), duration,
                result.getTokenCount(), result.getOutput(), result.getErrorMessage());

        // 5. 包装返回
        CapabilityExecuteResponse response = new CapabilityExecuteResponse();
        response.setResult(result);

        Map<String, String> routeInfo = new LinkedHashMap<>();
        routeInfo.put("agentCode", route.getAgentCode());
        routeInfo.put("clientId", route.getClientId());
        routeInfo.put("userId", route.getUserId());
        routeInfo.put("requiredCapability", route.getRequiredCapability());
        response.setRouteInfo(routeInfo);

        if (result.isSuccess()) {
            return ResponseEntity.ok(ApiResponse.ok("Capability 执行成功", response));
        } else {
            return ResponseEntity.ok(ApiResponse.error("AGENT_EXECUTION_FAILED", result.getErrorMessage()));
        }
    }

    @Operation(summary = "同步执行 Agent",
            description = "通过 agentCode 调用客户端 Agent。纯透传：body 中的 input 直接传给 Agent 执行。")
    @PostMapping("/agents/{agentCode}/execute")
    @RequiresPermission("ai:execute")
    public ResponseEntity<ApiResponse<AgentExecuteResult>> executeAgent(
            @PathVariable String agentCode,
            @RequestBody Map<String, Object> body) {

        @SuppressWarnings("unchecked")
        Map<String, Object> input = body.containsKey("input")
                ? (Map<String, Object>) body.get("input")
                : body;

        long timeoutMs = DEFAULT_TIMEOUT_MS;
        if (body.containsKey("timeoutMs")) {
            timeoutMs = ((Number) body.get("timeoutMs")).longValue();
        }

        String refType = (String) body.getOrDefault("refType", "n8n");
        String refId = body.containsKey("refId") ? String.valueOf(body.get("refId")) : null;

        log.info("[N8nAgentController] Execute agent={}, refType={}, refId={}, timeout={}ms",
                agentCode, refType, refId, timeoutMs);

        // 记录执行开始
        Long refIdLong = null;
        try {
            if (refId != null) {
                refIdLong = Long.parseLong(refId);
            }
        } catch (NumberFormatException e) {
            log.warn("[N8nAgentController] refId '{}' 无法转为 Long，executionRecord.referenceId 将为 null", refId);
        }

        String inputJson = serializeInput(input);
        AgentExecution execution = agentExecutionService.startExecution(
                agentCode, refType, refIdLong, "n8n", null, inputJson);
        long startTime = System.currentTimeMillis();

        AgentExecuteResult result;
        try {
            result = syncAgentService.executeSyncOnClient(
                    agentCode, input, refType, refId, timeoutMs);
        } catch (Exception e) {
            long duration = System.currentTimeMillis() - startTime;
            agentExecutionService.completeExecution(
                    execution.getId(), false, duration, null, null, e.getMessage());
            throw e;
        }

        // 记录执行完成
        long duration = System.currentTimeMillis() - startTime;
        agentExecutionService.completeExecution(
                execution.getId(), result.isSuccess(), duration,
                result.getTokenCount(), result.getOutput(), result.getErrorMessage());

        if (result.isSuccess()) {
            return ResponseEntity.ok(ApiResponse.ok("Agent 执行成功", result));
        } else {
            return ResponseEntity.ok(ApiResponse.error("AGENT_EXECUTION_FAILED", result.getErrorMessage()));
        }
    }

    @Operation(summary = "Sync Bridge 状态", description = "查看当前等待中的同步 Agent 调用数量和任务ID列表")
    @GetMapping("/agents/sync-bridge/status")
    @RequiresPermission("ai:view_logs")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getSyncBridgeStatus() {
        return ResponseEntity.ok(ApiResponse.ok("Sync Bridge 状态", syncAgentService.getStatusSnapshot()));
    }

    @Operation(summary = "Capability 健康检查",
            description = "检查指定 capability 是否可用（有 enabled 的 Agent + 在线客户端）。" +
                    "返回 status: healthy（可用）/ offline（不可用）+ 原因")
    @GetMapping("/capabilities/{capability}/health")
    @RequiresPermission("ai:view_logs")
    public ResponseEntity<ApiResponse<Map<String, Object>>> checkCapabilityHealth(
            @PathVariable String capability) {
        Map<String, Object> health = new LinkedHashMap<>();
        health.put("capability", capability);
        health.put("checkedAt", LocalDateTime.now().toString());

        try {
            CapabilityRouteResult route = capabilityRouter.route(capability, null, null);
            health.put("status", "healthy");
            health.put("agentCode", route.getAgentCode());
            health.put("clientId", route.getClientId());
            health.put("userId", route.getUserId());
            health.put("requiredCapability", route.getRequiredCapability());
        } catch (BusinessException e) {
            health.put("status", "offline");
            health.put("errorCode", e.getErrorCode().name());
            health.put("reason", e.getMessage());
        }

        return ResponseEntity.ok(ApiResponse.ok(health));
    }

    @Operation(summary = "全部业务 Capability 健康检查",
            description = "批量检查所有业务 Capability（如 ticket-translate, ticket-reply）的可用性。" +
                    "从 AgentDefinition 中提取唯一的 capability 值，逐一检查路由可用性")
    @GetMapping("/capabilities/health")
    @RequiresPermission("ai:view_logs")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> checkAllCapabilitiesHealth() {
        // 从 AgentDefinition 中提取所有唯一的业务 capability
        Set<String> capabilities = agentDefinitionService.findAll().stream()
                .map(agent -> agent.getCapability())
                .filter(cap -> cap != null && !cap.isBlank())
                .collect(Collectors.toCollection(LinkedHashSet::new));

        List<Map<String, Object>> results = capabilities.stream()
                .map(capability -> {
                    Map<String, Object> health = new LinkedHashMap<>();
                    health.put("capability", capability);

                    try {
                        CapabilityRouteResult route = capabilityRouter.route(capability, null, null);
                        health.put("status", "healthy");
                        health.put("agentCode", route.getAgentCode());
                        health.put("clientId", route.getClientId());
                        health.put("requiredCapability", route.getRequiredCapability());
                    } catch (BusinessException e) {
                        health.put("status", "offline");
                        health.put("errorCode", e.getErrorCode().name());
                        health.put("reason", e.getMessage());
                    }
                    return health;
                })
                .collect(Collectors.toList());

        // 追加技术 Capability 状态（enabled/disabled 概览）
        capabilityDefinitionService.getAllCapabilities().forEach(cap -> {
            Map<String, Object> techHealth = new LinkedHashMap<>();
            techHealth.put("capability", cap.getCode());
            techHealth.put("type", "tech");
            techHealth.put("name", cap.getName());
            techHealth.put("enabled", cap.isEnabled());
            techHealth.put("status", cap.isEnabled() ? "enabled" : "disabled");
            results.add(techHealth);
        });

        return ResponseEntity.ok(ApiResponse.ok(results));
    }

    @Operation(summary = "最近执行记录",
            description = "获取最近的 Agent 执行记录，按创建时间倒序排列。前端时间线面板使用。")
    @GetMapping("/agent/executions/recent")
    @RequiresPermission("ai:view_logs")
    public ResponseEntity<ApiResponse<List<AgentExecution>>> getRecentExecutions(
            @RequestParam(defaultValue = "20") int limit) {
        int effectiveLimit = Math.max(1, Math.min(limit, 100));
        Page<AgentExecution> page = agentExecutionService.findRecent(
                PageRequest.of(0, effectiveLimit, Sort.by(Sort.Direction.DESC, "createdAt")));
        return ResponseEntity.ok(ApiResponse.ok(page.getContent()));
    }

    @Operation(summary = "Agent 执行统计",
            description = "获取各 Agent 的执行统计信息（总数、成功数、失败数、平均耗时、成功率）")
    @GetMapping("/agent/executions/stats")
    @RequiresPermission("ai:view_logs")
    public ResponseEntity<ApiResponse<Object>> getExecutionStats() {
        return ResponseEntity.ok(ApiResponse.ok(agentExecutionService.getStatsDashboard()));
    }

    @Operation(summary = "断路器状态",
            description = "查看 Sync Bridge 断路器状态。当 capability 连续失败超过阈值时会断开。")
    @GetMapping("/agents/circuit-breaker/status")
    @RequiresPermission("ai:view_logs")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getCircuitBreakerStatus() {
        return ResponseEntity.ok(ApiResponse.ok(syncAgentService.getCircuitBreakerStatus()));
    }

    @Operation(summary = "重置断路器",
            description = "手动重置指定 capability 的断路器状态（从 OPEN → CLOSED）")
    @PostMapping("/agents/circuit-breaker/{capability}/reset")
    @RequiresPermission("ai:execute")
    public ResponseEntity<ApiResponse<String>> resetCircuitBreaker(@PathVariable String capability) {
        syncAgentService.resetCircuitBreaker(capability);
        log.info("[N8nAgentController] 断路器已重置: capability={}", capability);
        return ResponseEntity.ok(ApiResponse.ok("断路器已重置: " + capability));
    }

    /** 将 input Map 序列化为 JSON 字符串，失败时返回 toString() */
    private String serializeInput(Map<String, Object> input) {
        if (input == null || input.isEmpty()) return null;
        try {
            return objectMapper.writeValueAsString(input);
        } catch (JsonProcessingException e) {
            log.warn("[N8nAgentController] 序列化 input 失败: {}", e.getMessage());
            return input.toString();
        }
    }

    @Operation(summary = "路由统计",
            description = "获取 Capability 路由统计信息（各 capability 可用实例数）")
    @GetMapping("/capabilities/route-stats")
    @RequiresPermission("ai:view_logs")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getRouteStatistics() {
        return ResponseEntity.ok(ApiResponse.ok(capabilityRouter.getRouteStatistics()));
    }
}
