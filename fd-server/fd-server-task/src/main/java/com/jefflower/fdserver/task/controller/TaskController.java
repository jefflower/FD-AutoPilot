package com.jefflower.fdserver.task.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.task.dto.TaskCompleteRequest;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "任务分发", description = "客户端任务领取、完成、释放接口")
@Slf4j
@RestController
@RequestMapping("/api/v1/tasks")
@RequiredArgsConstructor
public class TaskController {

    private final TaskDistributionService taskDistributionService;

    /**
     * 领取任务
     */
    @Operation(summary = "领取任务", description = "客户端原子领取指定类型的任务，支持批量领取")
    @PostMapping("/claim")
    @RequiresPermission("task:claim")
    public ResponseEntity<ApiResponse<List<TaskInstance>>> claimTasks(
            @Parameter(description = "任务类型，如 ticket.translate, ticket.reply") @RequestParam String type,
            @Parameter(description = "客户端唯一标识") @RequestParam String clientId,
            @Parameter(description = "最大领取数量") @RequestParam(defaultValue = "5") int limit) {
        List<TaskInstance> tasks = taskDistributionService.claimTasks(type, clientId, limit);
        return ResponseEntity.ok(ApiResponse.ok(tasks));
    }

    /**
     * 完成任务
     */
    @Operation(summary = "完成任务", description = "客户端上报任务完成结果（成功或失败）")
    @PostMapping("/{id}/complete")
    @RequiresPermission("task:claim")
    public ResponseEntity<ApiResponse<Void>> completeTask(
            @Parameter(description = "任务实例 ID") @PathVariable Long id,
            @RequestBody TaskCompleteRequest request) {
        taskDistributionService.completeTask(id, request.getClientId(), request.isSuccess(), request.getMessage());
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    /**
     * 释放任务
     */
    @Operation(summary = "释放任务", description = "客户端主动释放已领取但未完成的任务，使其可被其他客户端领取")
    @PostMapping("/{id}/release")
    @RequiresPermission("task:claim")
    public ResponseEntity<ApiResponse<Void>> releaseTask(
            @Parameter(description = "任务实例 ID") @PathVariable Long id,
            @Parameter(description = "客户端唯一标识") @RequestParam String clientId) {
        taskDistributionService.releaseTask(id, clientId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    /**
     * 获取我的任务
     */
    @Operation(summary = "获取我的任务", description = "查询指定客户端当前已领取的任务列表")
    @GetMapping("/mine")
    @RequiresPermission("task:claim")
    public ResponseEntity<ApiResponse<List<TaskInstance>>> getMyTasks(
            @Parameter(description = "客户端唯一标识") @RequestParam String clientId) {
        List<TaskInstance> tasks = taskDistributionService.getMyTasks(clientId);
        return ResponseEntity.ok(ApiResponse.ok(tasks));
    }
}
