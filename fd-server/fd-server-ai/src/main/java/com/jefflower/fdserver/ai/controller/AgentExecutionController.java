package com.jefflower.fdserver.ai.controller;

import com.jefflower.fdserver.ai.dto.AgentExecuteRequest;
import com.jefflower.fdserver.ai.dto.AgentExecuteResult;
import com.jefflower.fdserver.ai.dto.AgentExecutionReport;
import com.jefflower.fdserver.ai.dto.AgentStats;
import com.jefflower.fdserver.ai.entity.AgentExecution;
import com.jefflower.fdserver.ai.service.AgentDispatchService;
import com.jefflower.fdserver.ai.service.AgentExecutionService;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/agents")
public class AgentExecutionController {

    private final AgentDispatchService dispatchService;
    private final AgentExecutionService executionService;

    public AgentExecutionController(AgentDispatchService dispatchService,
                                    AgentExecutionService executionService) {
        this.dispatchService = dispatchService;
        this.executionService = executionService;
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

    @GetMapping("/stats")
    @RequiresPermission("ai:view_logs")
    public ApiResponse<List<AgentStats>> getStats() {
        return ApiResponse.ok(executionService.getStatsDashboard());
    }
}
