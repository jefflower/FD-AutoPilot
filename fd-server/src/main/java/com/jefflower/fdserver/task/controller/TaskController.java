package com.jefflower.fdserver.task.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.task.dto.TaskCompleteRequest;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Slf4j
@RestController
@RequestMapping("/api/v1/tasks")
@RequiredArgsConstructor
public class TaskController {

    private final TaskDistributionService taskDistributionService;

    /**
     * 领取任务
     */
    @PostMapping("/claim")
    @RequiresPermission("task:claim")
    public ResponseEntity<ApiResponse<List<TaskInstance>>> claimTasks(
            @RequestParam String type,
            @RequestParam String clientId,
            @RequestParam(defaultValue = "5") int limit) {
        List<TaskInstance> tasks = taskDistributionService.claimTasks(type, clientId, limit);
        return ResponseEntity.ok(ApiResponse.ok(tasks));
    }

    /**
     * 完成任务
     */
    @PostMapping("/{id}/complete")
    @RequiresPermission("task:claim")
    public ResponseEntity<ApiResponse<Void>> completeTask(
            @PathVariable Long id,
            @RequestBody TaskCompleteRequest request) {
        taskDistributionService.completeTask(id, request.getClientId(), request.isSuccess(), request.getMessage());
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    /**
     * 释放任务
     */
    @PostMapping("/{id}/release")
    @RequiresPermission("task:claim")
    public ResponseEntity<ApiResponse<Void>> releaseTask(
            @PathVariable Long id,
            @RequestParam String clientId) {
        taskDistributionService.releaseTask(id, clientId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    /**
     * 获取我的任务
     */
    @GetMapping("/mine")
    @RequiresPermission("task:claim")
    public ResponseEntity<ApiResponse<List<TaskInstance>>> getMyTasks(
            @RequestParam String clientId) {
        List<TaskInstance> tasks = taskDistributionService.getMyTasks(clientId);
        return ResponseEntity.ok(ApiResponse.ok(tasks));
    }
}
