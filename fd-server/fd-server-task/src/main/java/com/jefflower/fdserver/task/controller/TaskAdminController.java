package com.jefflower.fdserver.task.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.task.entity.TaskDefinition;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.repository.TaskDefinitionRepository;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import com.jefflower.fdserver.task.service.TaskScheduleService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Tag(name = "任务管理", description = "任务定义管理、仪表盘统计、执行历史")
@Slf4j
@RestController
@RequestMapping("/api/v1/task-admin")
@RequiredArgsConstructor
public class TaskAdminController {

    private final TaskDefinitionRepository taskDefinitionRepository;
    private final TaskInstanceRepository taskInstanceRepository;
    private final TaskDistributionService taskDistributionService;
    private final TaskScheduleService taskScheduleService;

    /**
     * 仪表盘统计
     */
    @Operation(summary = "仪表盘统计", description = "获取各任务类型的状态统计数据，用于管理仪表盘展示")
    @GetMapping("/dashboard")
    @RequiresPermission("task:read")
    public ResponseEntity<ApiResponse<Map<String, Map<String, Long>>>> getDashboard() {
        Map<String, Map<String, Long>> stats = taskDistributionService.getDashboardStats();
        return ResponseEntity.ok(ApiResponse.ok(stats));
    }

    /**
     * 获取任务定义列表
     */
    @Operation(summary = "获取任务定义列表", description = "获取所有已注册的任务类型定义")
    @GetMapping("/definitions")
    @RequiresPermission("task:read")
    public ResponseEntity<ApiResponse<List<TaskDefinition>>> getDefinitions() {
        List<TaskDefinition> definitions = taskDefinitionRepository.findAll();
        return ResponseEntity.ok(ApiResponse.ok(definitions));
    }

    /**
     * 创建任务定义
     */
    @Operation(summary = "创建任务定义", description = "新增一个任务类型定义，包含执行模式、超时时间、重试策略等配置")
    @PostMapping("/definitions")
    @RequiresPermission("task:manage")
    public ResponseEntity<ApiResponse<TaskDefinition>> createDefinition(@RequestBody TaskDefinition definition) {
        definition.setCreatedAt(LocalDateTime.now());
        definition.setUpdatedAt(LocalDateTime.now());
        TaskDefinition saved = taskDefinitionRepository.save(definition);
        log.info("Created task definition: code={}, name={}", saved.getCode(), saved.getName());
        return ResponseEntity.ok(ApiResponse.ok(saved));
    }

    /**
     * 启用/禁用任务定义
     */
    @Operation(summary = "启用/禁用任务定义", description = "切换指定任务定义的启用状态")
    @PutMapping("/definitions/{id}/toggle")
    @RequiresPermission("task:manage")
    @Transactional
    public ResponseEntity<ApiResponse<TaskDefinition>> toggleDefinition(
            @Parameter(description = "任务定义 ID") @PathVariable Long id) {
        TaskDefinition def = taskDefinitionRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Task definition not found: " + id));
        def.setEnabled(!def.isEnabled());
        taskDefinitionRepository.save(def);
        log.info("Toggled task definition: code={}, enabled={}", def.getCode(), def.isEnabled());
        return ResponseEntity.ok(ApiResponse.ok(def));
    }

    /**
     * 手动触发任务
     */
    @Operation(summary = "手动触发任务", description = "根据任务定义 code 手动触发一次任务执行")
    @PostMapping("/definitions/{code}/trigger")
    @RequiresPermission("task:trigger")
    public ResponseEntity<ApiResponse<TaskInstance>> triggerTask(
            @Parameter(description = "任务定义 code") @PathVariable String code) {
        TaskInstance instance = taskScheduleService.triggerTask(code);
        return ResponseEntity.ok(ApiResponse.ok(instance));
    }

    /**
     * 查看任务历史
     */
    @Operation(summary = "查看任务历史", description = "分页查询任务执行历史记录，可按任务类型过滤")
    @GetMapping("/history")
    @RequiresPermission("task:read")
    public ResponseEntity<ApiResponse<Page<TaskInstance>>> getHistory(
            @Parameter(description = "任务类型过滤") @RequestParam(required = false) String type,
            @Parameter(description = "页码，从 0 开始") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "每页大小") @RequestParam(defaultValue = "20") int size) {
        Page<TaskInstance> history;
        if (type != null && !type.isBlank()) {
            history = taskInstanceRepository.findByTaskTypeOrderByCreatedAtDesc(type, PageRequest.of(page, size));
        } else {
            history = taskInstanceRepository.findAllByOrderByCreatedAtDesc(PageRequest.of(page, size));
        }
        return ResponseEntity.ok(ApiResponse.ok(history));
    }

    /**
     * 批量取消活跃任务（按 referenceId 范围）
     */
    @Operation(summary = "批量取消任务", description = "取消指定 referenceId 范围内的 PENDING/CLAIMED 任务")
    @PostMapping("/cancel-batch")
    @RequiresPermission("task:manage")
    @Transactional
    public ResponseEntity<ApiResponse<Integer>> cancelBatch(
            @RequestParam String taskType,
            @RequestParam(required = false) Long refIdBelow) {
        LocalDateTime now = LocalDateTime.now();
        List<TaskInstance> tasks = taskInstanceRepository.findByTaskTypeAndStatus(taskType, TaskStatus.PENDING);
        int count = 0;
        for (TaskInstance task : tasks) {
            try {
                long refId = Long.parseLong(task.getReferenceId());
                if (refIdBelow != null && refId >= refIdBelow) continue;
            } catch (NumberFormatException ignored) { continue; }
            task.setStatus(TaskStatus.CANCELLED);
            task.setCompletedAt(now);
            taskInstanceRepository.save(task);
            count++;
        }
        log.info("Batch cancelled {} tasks for type={}, refIdBelow={}", count, taskType, refIdBelow);
        return ResponseEntity.ok(ApiResponse.ok("批量取消完成", count));
    }

    /**
     * 清理历史记录
     */
    @Operation(summary = "清理历史记录", description = "清理指定天数之前的已完成/失败/超时/已取消的任务记录")
    @DeleteMapping("/history/cleanup")
    @RequiresPermission("task:manage")
    @Transactional
    public ResponseEntity<ApiResponse<Integer>> cleanupHistory(
            @Parameter(description = "清理多少天之前的记录") @RequestParam(defaultValue = "30") int daysOld) {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(daysOld);
        int deleted = taskInstanceRepository.deleteOldTasks(
                List.of(TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.TIMEOUT, TaskStatus.CANCELLED),
                cutoff);
        log.info("Cleaned up {} old task instances (older than {} days)", deleted, daysOld);
        return ResponseEntity.ok(ApiResponse.ok("清理完成", deleted));
    }
}
