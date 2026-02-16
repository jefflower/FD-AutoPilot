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
    @GetMapping("/dashboard")
    @RequiresPermission("task:read")
    public ResponseEntity<ApiResponse<Map<String, Map<String, Long>>>> getDashboard() {
        Map<String, Map<String, Long>> stats = taskDistributionService.getDashboardStats();
        return ResponseEntity.ok(ApiResponse.ok(stats));
    }

    /**
     * 获取任务定义列表
     */
    @GetMapping("/definitions")
    @RequiresPermission("task:read")
    public ResponseEntity<ApiResponse<List<TaskDefinition>>> getDefinitions() {
        List<TaskDefinition> definitions = taskDefinitionRepository.findAll();
        return ResponseEntity.ok(ApiResponse.ok(definitions));
    }

    /**
     * 创建任务定义
     */
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
    @PutMapping("/definitions/{id}/toggle")
    @RequiresPermission("task:manage")
    @Transactional
    public ResponseEntity<ApiResponse<TaskDefinition>> toggleDefinition(@PathVariable Long id) {
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
    @PostMapping("/definitions/{code}/trigger")
    @RequiresPermission("task:trigger")
    public ResponseEntity<ApiResponse<TaskInstance>> triggerTask(@PathVariable String code) {
        TaskInstance instance = taskScheduleService.triggerTask(code);
        return ResponseEntity.ok(ApiResponse.ok(instance));
    }

    /**
     * 查看任务历史
     */
    @GetMapping("/history")
    @RequiresPermission("task:read")
    public ResponseEntity<ApiResponse<Page<TaskInstance>>> getHistory(
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<TaskInstance> history;
        if (type != null && !type.isBlank()) {
            history = taskInstanceRepository.findByTaskTypeOrderByCreatedAtDesc(type, PageRequest.of(page, size));
        } else {
            history = taskInstanceRepository.findAllByOrderByCreatedAtDesc(PageRequest.of(page, size));
        }
        return ResponseEntity.ok(ApiResponse.ok(history));
    }

    /**
     * 清理历史记录
     */
    @DeleteMapping("/history/cleanup")
    @RequiresPermission("task:manage")
    @Transactional
    public ResponseEntity<ApiResponse<Integer>> cleanupHistory(
            @RequestParam(defaultValue = "30") int daysOld) {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(daysOld);
        int deleted = taskInstanceRepository.deleteOldTasks(
                List.of(TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.TIMEOUT, TaskStatus.CANCELLED),
                cutoff);
        log.info("Cleaned up {} old task instances (older than {} days)", deleted, daysOld);
        return ResponseEntity.ok(ApiResponse.ok("清理完成", deleted));
    }
}
