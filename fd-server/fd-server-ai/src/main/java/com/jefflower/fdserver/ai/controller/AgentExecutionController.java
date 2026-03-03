package com.jefflower.fdserver.ai.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.jefflower.fdserver.ai.dto.*;
import com.jefflower.fdserver.ai.entity.AgentExecution;
import com.jefflower.fdserver.ai.service.AgentChatService;
import com.jefflower.fdserver.ai.service.AgentDispatchService;
import com.jefflower.fdserver.ai.service.AgentExecutionService;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

@Tag(name = "Agent 执行", description = "Agent 执行调度、历史记录、统计分析")
@RestController
@RequestMapping("/api/v1/agents")
public class AgentExecutionController {

    private final AgentDispatchService dispatchService;
    private final AgentExecutionService executionService;
    private final AgentChatService agentChatService;

    public AgentExecutionController(AgentDispatchService dispatchService,
                                    AgentExecutionService executionService,
                                    AgentChatService agentChatService) {
        this.dispatchService = dispatchService;
        this.executionService = executionService;
        this.agentChatService = agentChatService;
    }

    @PostMapping("/execute/{code}")
    @RequiresPermission("ai:execute")
    public ApiResponse<AgentExecuteResult> executeAgent(@PathVariable String code,
                                                         @RequestBody AgentExecuteRequest request,
                                                         Authentication auth) {
        String userId = auth != null ? auth.getName() : "anonymous";
        AgentExecuteResult result = dispatchService.executeOnServer(
                code, request.getInput(), request.getReferenceType(), request.getReferenceId(), userId);
        return ApiResponse.ok(result);
    }

    @PostMapping("/{code}/chat")
    @RequiresPermission("ai:execute")
    public ApiResponse<AgentChatResponse> chatWithAgent(@PathVariable String code,
                                                         @RequestBody AgentChatRequest request) {
        AgentChatResponse response = agentChatService.chat(
                code,
                request.getUserMessage(),
                request.getConversationHistory(),
                request.getContextData(),
                request.getRefType(),
                request.getRefId());
        return ApiResponse.ok(response);
    }

    @PostMapping("/executions/report")
    public ApiResponse<Void> reportExecution(@RequestBody AgentExecutionReport report) {
        executionService.reportFromClient(report);
        return ApiResponse.ok("上报成功", null);
    }

    @GetMapping("/executions")
    @RequiresPermission("ai:view_logs")
    public ApiResponse<Page<AgentExecution>> getExecutions(
            @RequestParam(required = false) String agentCode,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<AgentExecution> result;
        if (agentCode != null && !agentCode.isEmpty()) {
            result = executionService.findByAgent(agentCode, PageRequest.of(page, size));
        } else {
            result = executionService.findRecent(PageRequest.of(page, size));
        }
        return ApiResponse.ok(result);
    }

    @GetMapping("/executions/recent")
    @RequiresPermission("ai:view_logs")
    public ApiResponse<List<AgentExecution>> getRecentExecutions(
            @RequestParam(defaultValue = "20") int limit) {
        int effectiveLimit = Math.max(1, Math.min(limit, 100));
        Page<AgentExecution> page = executionService.findRecent(
                PageRequest.of(0, effectiveLimit, Sort.by(Sort.Direction.DESC, "createdAt")));
        return ApiResponse.ok(page.getContent());
    }

    @GetMapping("/executions/running")
    @RequiresPermission("ai:view_logs")
    public ApiResponse<List<AgentExecution>> getRunningExecutions() {
        return ApiResponse.ok(executionService.findRunning());
    }

    @GetMapping("/stats")
    @RequiresPermission("ai:view_logs")
    public ApiResponse<List<AgentStats>> getStats() {
        return ApiResponse.ok(executionService.getStatsDashboard());
    }

    // ==================== 导出端点 ====================

    @GetMapping("/executions/export/csv")
    @RequiresPermission("ai:view_logs")
    public void exportCsv(@RequestParam(required = false) String agentCode,
                           @RequestParam(required = false) String status,
                           @RequestParam(defaultValue = "30") int days,
                           HttpServletResponse response) throws IOException {
        List<AgentExecution> executions = executionService.findForExport(agentCode, status, days);
        String filename = "agent-executions-" + LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE) + ".csv";

        response.setContentType("text/csv");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");

        // 写入 BOM 头以支持 Excel 中文显示
        response.getOutputStream().write(new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF});

        try (PrintWriter writer = new PrintWriter(
                new OutputStreamWriter(response.getOutputStream(), StandardCharsets.UTF_8))) {
            // 写入表头
            writer.println("id,agentCode,status,durationMs,tokenCount,referenceType,referenceId,executedBy,executedOn,errorMessage,createdAt");

            // 写入数据行
            for (AgentExecution exec : executions) {
                writer.println(String.join(",",
                        csvField(exec.getId()),
                        csvField(exec.getAgentCode()),
                        csvField(exec.getStatus()),
                        csvField(exec.getDurationMs()),
                        csvField(exec.getTokenCount()),
                        csvField(exec.getReferenceType()),
                        csvField(exec.getReferenceId()),
                        csvField(exec.getExecutedBy()),
                        csvField(exec.getExecutedOn()),
                        csvField(exec.getErrorMessage()),
                        csvField(exec.getCreatedAt())
                ));
            }
            writer.flush();
        }
    }

    @GetMapping("/executions/export/json")
    @RequiresPermission("ai:view_logs")
    public void exportJson(@RequestParam(required = false) String agentCode,
                            @RequestParam(required = false) String status,
                            @RequestParam(defaultValue = "30") int days,
                            HttpServletResponse response) throws IOException {
        List<AgentExecution> executions = executionService.findForExport(agentCode, status, days);
        String filename = "agent-executions-" + LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE) + ".json";

        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");

        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        mapper.writerWithDefaultPrettyPrinter().writeValue(response.getOutputStream(), executions);
    }

    // ==================== CSV 工具方法 ====================

    private String csvField(Object value) {
        if (value == null) {
            return "";
        }
        String str = value.toString();
        // 如果包含逗号、引号或换行符，需要用引号包裹并转义内部引号
        if (str.contains(",") || str.contains("\"") || str.contains("\n") || str.contains("\r")) {
            return "\"" + str.replace("\"", "\"\"") + "\"";
        }
        return str;
    }
}
