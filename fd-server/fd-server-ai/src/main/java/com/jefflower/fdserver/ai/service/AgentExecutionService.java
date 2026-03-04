package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.dto.AgentExecutionReport;
import com.jefflower.fdserver.ai.dto.AgentStats;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentExecution;
import com.jefflower.fdserver.ai.enums.ExecutionStatus;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.AgentExecutionRepository;
import com.jefflower.fdserver.task.sse.SseConnectionManager;
import com.jefflower.fdserver.task.sse.SseEventData;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class AgentExecutionService {

    /** 执行历史保留天数，默认 30 天 */
    @Value("${agent.execution.retention-days:30}")
    private int retentionDays;

    private final AgentExecutionRepository executionRepository;
    private final AgentDefinitionRepository definitionRepository;
    private final SseConnectionManager sseConnectionManager;

    public AgentExecutionService(AgentExecutionRepository executionRepository,
                                 AgentDefinitionRepository definitionRepository,
                                 SseConnectionManager sseConnectionManager) {
        this.executionRepository = executionRepository;
        this.definitionRepository = definitionRepository;
        this.sseConnectionManager = sseConnectionManager;
    }

    @Transactional
    public AgentExecution startExecution(String agentCode, String refType, Long refId,
                                         String executedBy, String executedOn) {
        AgentExecution exec = new AgentExecution();
        exec.setAgentCode(agentCode);
        exec.setStatus(ExecutionStatus.RUNNING);
        exec.setReferenceType(refType);
        exec.setReferenceId(refId);
        exec.setExecutedBy(executedBy);
        exec.setExecutedOn(executedOn);
        AgentExecution saved = executionRepository.save(exec);
        broadcastExecutionEvent("agent-execution-started", saved);
        return saved;
    }

    @Transactional
    public void completeExecution(Long executionId, boolean success, Long durationMs,
                                  Integer tokenCount, String output, String error) {
        executionRepository.findById(executionId).ifPresent(exec -> {
            exec.setStatus(success ? ExecutionStatus.SUCCESS : ExecutionStatus.FAILED);
            exec.setDurationMs(durationMs);
            exec.setTokenCount(tokenCount);
            exec.setOutputSnapshot(truncate(output, 2000));
            exec.setErrorMessage(error);
            AgentExecution saved = executionRepository.save(exec);
            broadcastExecutionEvent("agent-execution-completed", saved);
        });
    }

    @Transactional
    public void reportFromClient(AgentExecutionReport report) {
        AgentExecution exec = new AgentExecution();
        exec.setAgentCode(report.getAgentCode());
        exec.setStatus(parseStatus(report.getStatus()));
        exec.setDurationMs(report.getDurationMs());
        exec.setTokenCount(report.getTokenCount());
        exec.setReferenceType(report.getReferenceType());
        exec.setReferenceId(report.getReferenceId());
        exec.setExecutedOn(report.getExecutedOn());
        exec.setInputSnapshot(truncate(report.getInputSnapshot(), 2000));
        exec.setOutputSnapshot(truncate(report.getOutputSnapshot(), 2000));
        exec.setErrorMessage(report.getErrorMessage());
        AgentExecution saved = executionRepository.save(exec);
        broadcastExecutionEvent("agent-execution-completed", saved);
    }

    public Page<AgentExecution> findByAgent(String agentCode, Pageable pageable) {
        return executionRepository.findByAgentCodeOrderByCreatedAtDesc(agentCode, pageable);
    }

    public Page<AgentExecution> findRecent(Pageable pageable) {
        return executionRepository.findAllByOrderByCreatedAtDesc(pageable);
    }

    /**
     * 按过滤条件分页查询执行记录（支持 agentCode 和 status 组合过滤）。
     */
    public Page<AgentExecution> findByFilters(String agentCode, String status, Pageable pageable) {
        boolean hasAgent = agentCode != null && !agentCode.isEmpty();
        boolean hasStatus = status != null && !status.isEmpty();

        if (hasAgent && hasStatus) {
            ExecutionStatus es = parseStatus(status);
            return executionRepository.findByAgentCodeAndStatusOrderByCreatedAtDesc(agentCode, es, pageable);
        } else if (hasAgent) {
            return executionRepository.findByAgentCodeOrderByCreatedAtDesc(agentCode, pageable);
        } else if (hasStatus) {
            ExecutionStatus es = parseStatus(status);
            return executionRepository.findByStatusOrderByCreatedAtDesc(es, pageable);
        } else {
            return executionRepository.findAllByOrderByCreatedAtDesc(pageable);
        }
    }

    public List<AgentStats> getStatsDashboard() {
        List<AgentDefinition> definitions = definitionRepository.findAllByOrderBySortOrder();
        List<AgentStats> statsList = new ArrayList<>();

        for (AgentDefinition def : definitions) {
            String code = def.getCode();
            long total = executionRepository.countByAgentCode(code);
            long success = executionRepository.countByAgentCodeAndStatus(code, ExecutionStatus.SUCCESS);
            long failed = executionRepository.countByAgentCodeAndStatus(code, ExecutionStatus.FAILED);
            Double avgDuration = executionRepository.findAvgDurationByAgentCode(code);

            double successRate = total > 0 ? (double) success / total * 100 : 0;

            statsList.add(new AgentStats(
                    code,
                    def.getName(),
                    total,
                    success,
                    failed,
                    avgDuration != null ? avgDuration : 0,
                    Math.round(successRate * 100.0) / 100.0
            ));
        }

        return statsList;
    }

    /**
     * 按条件查询执行记录（用于导出）。
     *
     * @param agentCode 可选 Agent 代码
     * @param status    可选状态过滤
     * @param days      最近多少天
     * @return 满足条件的执行记录列表
     */
    public List<AgentExecution> findForExport(String agentCode, String status, int days) {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(days);
        boolean hasAgent = agentCode != null && !agentCode.isEmpty();
        boolean hasStatus = status != null && !status.isEmpty();

        if (hasAgent && hasStatus) {
            ExecutionStatus es = parseStatus(status);
            return executionRepository.findByAgentCodeAndStatusAndCreatedAtAfterOrderByCreatedAtDesc(agentCode, es, cutoff);
        } else if (hasAgent) {
            return executionRepository.findByAgentCodeAndCreatedAtAfterOrderByCreatedAtDesc(agentCode, cutoff);
        } else if (hasStatus) {
            ExecutionStatus es = parseStatus(status);
            return executionRepository.findByStatusAndCreatedAtAfterOrderByCreatedAtDesc(es, cutoff);
        } else {
            return executionRepository.findByCreatedAtAfterOrderByCreatedAtDesc(cutoff);
        }
    }

    private ExecutionStatus parseStatus(String status) {
        try {
            return ExecutionStatus.valueOf(status);
        } catch (Exception e) {
            return ExecutionStatus.FAILED;
        }
    }

    /**
     * 定时清理过期的执行历史记录。
     * 每天凌晨 3 点执行，删除超过 retentionDays 的记录。
     */
    @Scheduled(cron = "0 0 3 * * ?")
    @Transactional
    public void cleanupOldExecutions() {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(retentionDays);
        long countBefore = executionRepository.count();
        executionRepository.deleteByCreatedAtBefore(cutoff);
        long countAfter = executionRepository.count();
        long deleted = countBefore - countAfter;
        if (deleted > 0) {
            log.info("[AgentExecution] 清理过期执行记录: 删除 {} 条 (保留 {} 天, cutoff={})",
                    deleted, retentionDays, cutoff);
        }
    }

    /**
     * 查询当前所有 RUNNING 状态的执行记录。
     */
    public List<AgentExecution> findRunning() {
        return executionRepository.findByStatusOrderByCreatedAtDesc(ExecutionStatus.RUNNING);
    }

    /**
     * 广播 Agent 执行生命周期 SSE 事件。
     * 包裹在 try-catch 中，确保广播失败不会影响主流程。
     */
    private void broadcastExecutionEvent(String eventType, AgentExecution exec) {
        try {
            Map<String, Object> data = new HashMap<>();
            data.put("executionId", exec.getId());
            data.put("agentCode", exec.getAgentCode());
            data.put("status", exec.getStatus().name());
            data.put("referenceType", exec.getReferenceType());
            data.put("referenceId", exec.getReferenceId());
            data.put("durationMs", exec.getDurationMs());
            data.put("errorMessage", exec.getErrorMessage());
            sseConnectionManager.broadcast(new SseEventData(eventType, data));
        } catch (Exception e) {
            log.warn("[AgentExecutionService] Failed to broadcast SSE event: {}", e.getMessage());
        }
    }

    private String truncate(String text, int maxLen) {
        if (text == null) return null;
        return text.length() > maxLen ? text.substring(0, maxLen) + "...[truncated]" : text;
    }
}
