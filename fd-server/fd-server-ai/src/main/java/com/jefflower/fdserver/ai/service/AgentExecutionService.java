package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.dto.AgentExecutionReport;
import com.jefflower.fdserver.ai.dto.AgentStats;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentExecution;
import com.jefflower.fdserver.ai.enums.ExecutionStatus;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.AgentExecutionRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

@Service
public class AgentExecutionService {

    private final AgentExecutionRepository executionRepository;
    private final AgentDefinitionRepository definitionRepository;

    public AgentExecutionService(AgentExecutionRepository executionRepository,
                                 AgentDefinitionRepository definitionRepository) {
        this.executionRepository = executionRepository;
        this.definitionRepository = definitionRepository;
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
        return executionRepository.save(exec);
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
            executionRepository.save(exec);
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
        executionRepository.save(exec);
    }

    public Page<AgentExecution> findByAgent(String agentCode, Pageable pageable) {
        return executionRepository.findByAgentCodeOrderByCreatedAtDesc(agentCode, pageable);
    }

    public Page<AgentExecution> findRecent(Pageable pageable) {
        return executionRepository.findAllByOrderByCreatedAtDesc(pageable);
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

    private ExecutionStatus parseStatus(String status) {
        try {
            return ExecutionStatus.valueOf(status);
        } catch (Exception e) {
            return ExecutionStatus.FAILED;
        }
    }

    private String truncate(String text, int maxLen) {
        if (text == null) return null;
        return text.length() > maxLen ? text.substring(0, maxLen) + "...[truncated]" : text;
    }
}
