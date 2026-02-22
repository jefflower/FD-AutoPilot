package com.jefflower.fdserver.workflow.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.workflow.service.WorkflowService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/workflows/instances")
public class WorkflowInstanceController {

    private final WorkflowService workflowService;

    public WorkflowInstanceController(WorkflowService workflowService) {
        this.workflowService = workflowService;
    }

    @GetMapping("/{processInstanceId}/activities")
    @RequiresPermission("workflow:monitor")
    public ApiResponse<List<String>> getActiveActivities(@PathVariable String processInstanceId) {
        return ApiResponse.ok(workflowService.getActiveActivityIds(processInstanceId));
    }

    @PostMapping("/{processInstanceId}/signal")
    @RequiresPermission("workflow:monitor")
    public ApiResponse<Void> signalReceiveTask(@PathVariable String processInstanceId,
                                                @RequestBody Map<String, Object> body) {
        String activityId = (String) body.get("activityId");
        @SuppressWarnings("unchecked")
        Map<String, Object> vars = (Map<String, Object>) body.getOrDefault("variables", Map.of());
        workflowService.signalReceiveTask(processInstanceId, activityId, vars);
        return ApiResponse.ok("信号发送成功", null);
    }

    @DeleteMapping("/{processInstanceId}")
    @RequiresPermission("workflow:monitor")
    public ApiResponse<Void> terminateProcess(@PathVariable String processInstanceId,
                                               @RequestParam(defaultValue = "手动终止") String reason) {
        workflowService.terminateProcess(processInstanceId, reason);
        return ApiResponse.ok("流程已终止", null);
    }
}
