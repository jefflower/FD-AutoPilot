package com.jefflower.fdserver.workflow.scheduler;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.task.entity.TaskInstance;
import com.jefflower.fdserver.task.enums.TaskStatus;
import com.jefflower.fdserver.task.repository.TaskInstanceRepository;
import com.jefflower.fdserver.workflow.service.WorkflowService;
import com.jefflower.fdserver.workflow.service.WorkflowTaskBridge;
import org.flowable.engine.runtime.Execution;
import org.flowable.engine.runtime.ProcessInstance;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * BPMN ReceiveTask 超时检测与恢复调度器。
 * <p>
 * 补全工作流的最后一道防线：当 TaskCompletedEvent → WorkflowTaskBridge 的信号链路断裂时，
 * ReceiveTask 会永远等待。本调度器定期扫描卡住的流程实例，尝试自动恢复。
 * <p>
 * 恢复策略：
 * <ol>
 *   <li>软超时（30 分钟）：检查对应 TaskInstance 是否已完成/超时，重新触发桥接信号</li>
 *   <li>人工 ReceiveTask（audit_create_wait）：仅记录日志，等待人工操作</li>
 * </ol>
 */
@Component
public class WorkflowTimeoutScheduler {

    private static final Logger log = LoggerFactory.getLogger(WorkflowTimeoutScheduler.class);

    /** ReceiveTask 软超时（分钟）：等待超过此时间尝试恢复 */
    static final int SOFT_TIMEOUT_MINUTES = 30;

    /** Agent 任务关联的 ReceiveTask（通过 TaskCompletedEvent → WorkflowTaskBridge 唤醒） */
    static final List<String> AGENT_RECEIVE_TASKS = List.of(
            "translate_agent_wait", "reply_agent_wait");

    /** 人工任务关联的 ReceiveTask（通过业务代码手动唤醒） */
    static final List<String> HUMAN_RECEIVE_TASKS = List.of(
            "audit_create_wait");

    private final WorkflowService workflowService;
    private final WorkflowTaskBridge taskBridge;
    private final TaskInstanceRepository taskInstanceRepository;
    private final ObjectMapper objectMapper;

    public WorkflowTimeoutScheduler(WorkflowService workflowService,
                                     WorkflowTaskBridge taskBridge,
                                     TaskInstanceRepository taskInstanceRepository,
                                     ObjectMapper objectMapper) {
        this.workflowService = workflowService;
        this.taskBridge = taskBridge;
        this.taskInstanceRepository = taskInstanceRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * 每 2 分钟扫描卡住的 ReceiveTask。
     */
    @Scheduled(fixedDelay = 120_000)
    public void recoverStuckReceiveTasks() {
        Instant softCutoff = Instant.now().minus(Duration.ofMinutes(SOFT_TIMEOUT_MINUTES));
        List<ProcessInstance> stuckProcesses = workflowService.findStuckProcessInstances(softCutoff);
        if (stuckProcesses.isEmpty()) return;

        log.debug("[WorkflowTimeout] Scanning {} processes started before {}",
                stuckProcesses.size(), softCutoff);

        int recovered = 0;
        int terminated = 0;

        for (ProcessInstance process : stuckProcesses) {
            try {
                int result = handleStuckProcess(process);
                if (result == 1) recovered++;
                else if (result == -1) terminated++;
            } catch (Exception e) {
                log.error("[WorkflowTimeout] Error recovering process {}: {}",
                        process.getId(), e.getMessage(), e);
            }
        }

        if (recovered > 0 || terminated > 0) {
            log.info("[WorkflowTimeout] Scan complete: {} recovered, {} terminated (of {} checked)",
                    recovered, terminated, stuckProcesses.size());
        }
    }

    /**
     * 处理单个卡住的流程实例。
     *
     * @return 1=已恢复，-1=已终止，0=无操作
     */
    int handleStuckProcess(ProcessInstance process) {
        String processInstanceId = process.getId();
        Instant startTime = process.getStartTime().toInstant();

        // 检查 Agent ReceiveTask（可通过 TaskInstance 状态恢复）
        for (String activityId : AGENT_RECEIVE_TASKS) {
            Execution execution = workflowService.findReceiveTaskExecution(processInstanceId, activityId);
            if (execution != null) {
                boolean recovered = tryRecoverAgentReceiveTask(processInstanceId, activityId);
                if (recovered) return 1;
            }
        }

        // 人工 ReceiveTask 仅记录日志（无法自动恢复，需人工操作）
        for (String activityId : HUMAN_RECEIVE_TASKS) {
            Execution execution = workflowService.findReceiveTaskExecution(processInstanceId, activityId);
            if (execution != null) {
                log.info("[WorkflowTimeout] Process {} (businessKey={}) stuck at human ReceiveTask {}, awaiting manual action",
                        processInstanceId, process.getBusinessKey(), activityId);
            }
        }

        return 0;
    }

    /**
     * 尝试恢复 Agent ReceiveTask：
     * <ol>
     *   <li>查找 payload 中包含 processInstanceId 的 TaskInstance</li>
     *   <li>如果 COMPLETED → 重新触发桥接信号（信号丢失恢复）</li>
     *   <li>如果 TIMEOUT → 通知流程任务失败</li>
     * </ol>
     *
     * @return true 表示成功触发恢复动作
     */
    boolean tryRecoverAgentReceiveTask(String processInstanceId, String activityId) {
        List<TaskInstance> tasks = taskInstanceRepository.findByPayloadContainingAndStatusIn(
                processInstanceId, List.of(TaskStatus.COMPLETED, TaskStatus.TIMEOUT));

        for (TaskInstance task : tasks) {
            String waitActivityId = extractWaitActivityId(task.getPayload());
            if (!activityId.equals(waitActivityId)) continue;

            if (task.getStatus() == TaskStatus.COMPLETED) {
                log.info("[WorkflowTimeout] Re-bridging completed task {} → ReceiveTask {} (process={})",
                        task.getId(), activityId, processInstanceId);
                try {
                    taskBridge.onTaskCompleted(task, Map.of("taskSuccess", true));
                    return true;
                } catch (Exception e) {
                    log.error("[WorkflowTimeout] Re-bridge failed for task {} → {}: {}",
                            task.getId(), activityId, e.getMessage(), e);
                }
            } else if (task.getStatus() == TaskStatus.TIMEOUT) {
                log.info("[WorkflowTimeout] Signaling failure for timed-out task {} → ReceiveTask {} (process={})",
                        task.getId(), activityId, processInstanceId);
                try {
                    taskBridge.onTaskCompleted(task, Map.of("taskSuccess", false));
                    return true;
                } catch (Exception e) {
                    log.error("[WorkflowTimeout] Failure signal failed for task {} → {}: {}",
                            task.getId(), activityId, e.getMessage(), e);
                }
            }
        }

        log.debug("[WorkflowTimeout] No completed/timed-out task found for ReceiveTask {} in process {}",
                activityId, processInstanceId);
        return false;
    }

    /**
     * 从 TaskInstance payload JSON 中提取 waitActivityId。
     */
    String extractWaitActivityId(String payload) {
        if (payload == null || payload.isBlank()) return null;
        try {
            Map<String, Object> map = objectMapper.readValue(payload, new TypeReference<>() {});
            return (String) map.get("waitActivityId");
        } catch (Exception e) {
            log.warn("[WorkflowTimeout] Failed to parse payload: {}", e.getMessage());
            return null;
        }
    }
}
