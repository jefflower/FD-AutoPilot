package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.dto.AgentExecutionReport;
import com.jefflower.fdserver.ai.dto.AgentStats;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentExecution;
import com.jefflower.fdserver.ai.enums.ExecutionStatus;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.AgentExecutionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AgentExecutionServiceTest {

    @Mock
    private AgentExecutionRepository executionRepository;

    @Mock
    private AgentDefinitionRepository definitionRepository;

    @InjectMocks
    private AgentExecutionService service;

    private AgentDefinition translateDef;
    private AgentDefinition replyDef;

    @BeforeEach
    void setUp() {
        translateDef = new AgentDefinition();
        translateDef.setId(1L);
        translateDef.setCode("gemini-translate");
        translateDef.setName("Gemini 翻译");
        translateDef.setSortOrder(1);

        replyDef = new AgentDefinition();
        replyDef.setId(2L);
        replyDef.setCode("notebooklm-reply");
        replyDef.setName("NotebookLM 回复");
        replyDef.setSortOrder(2);
    }

    // ========== startExecution ==========

    @Test
    void startExecution_createsRunningRecord() {
        when(executionRepository.save(any(AgentExecution.class))).thenAnswer(inv -> {
            AgentExecution exec = inv.getArgument(0);
            exec.setId(100L);
            return exec;
        });

        AgentExecution result = service.startExecution(
                "gemini-translate", "ticket", 42L, "client-001", "desktop");

        assertNotNull(result);
        assertEquals("gemini-translate", result.getAgentCode());
        assertEquals(ExecutionStatus.RUNNING, result.getStatus());
        assertEquals("ticket", result.getReferenceType());
        assertEquals(42L, result.getReferenceId());
        assertEquals("client-001", result.getExecutedBy());
        assertEquals("desktop", result.getExecutedOn());

        ArgumentCaptor<AgentExecution> captor = ArgumentCaptor.forClass(AgentExecution.class);
        verify(executionRepository).save(captor.capture());
        assertEquals(ExecutionStatus.RUNNING, captor.getValue().getStatus());
    }

    // ========== completeExecution ==========

    @Test
    void completeExecution_setsSuccessStatus() {
        AgentExecution exec = new AgentExecution();
        exec.setId(100L);
        exec.setAgentCode("gemini-translate");
        exec.setStatus(ExecutionStatus.RUNNING);

        when(executionRepository.findById(100L)).thenReturn(Optional.of(exec));
        when(executionRepository.save(any(AgentExecution.class))).thenAnswer(inv -> inv.getArgument(0));

        service.completeExecution(100L, true, 1500L, 200, "翻译结果", null);

        ArgumentCaptor<AgentExecution> captor = ArgumentCaptor.forClass(AgentExecution.class);
        verify(executionRepository).save(captor.capture());
        AgentExecution saved = captor.getValue();
        assertEquals(ExecutionStatus.SUCCESS, saved.getStatus());
        assertEquals(1500L, saved.getDurationMs());
        assertEquals(200, saved.getTokenCount());
        assertEquals("翻译结果", saved.getOutputSnapshot());
        assertNull(saved.getErrorMessage());
    }

    @Test
    void completeExecution_setsFailedStatus() {
        AgentExecution exec = new AgentExecution();
        exec.setId(100L);
        exec.setStatus(ExecutionStatus.RUNNING);

        when(executionRepository.findById(100L)).thenReturn(Optional.of(exec));
        when(executionRepository.save(any(AgentExecution.class))).thenAnswer(inv -> inv.getArgument(0));

        service.completeExecution(100L, false, 500L, null, null, "超时异常");

        ArgumentCaptor<AgentExecution> captor = ArgumentCaptor.forClass(AgentExecution.class);
        verify(executionRepository).save(captor.capture());
        AgentExecution saved = captor.getValue();
        assertEquals(ExecutionStatus.FAILED, saved.getStatus());
        assertEquals("超时异常", saved.getErrorMessage());
        assertNull(saved.getOutputSnapshot());
    }

    @Test
    void completeExecution_truncatesLongOutput() {
        AgentExecution exec = new AgentExecution();
        exec.setId(100L);
        exec.setStatus(ExecutionStatus.RUNNING);

        when(executionRepository.findById(100L)).thenReturn(Optional.of(exec));
        when(executionRepository.save(any(AgentExecution.class))).thenAnswer(inv -> inv.getArgument(0));

        // 构造超过 2000 字符的输出
        String longOutput = "A".repeat(2500);

        service.completeExecution(100L, true, 1000L, null, longOutput, null);

        ArgumentCaptor<AgentExecution> captor = ArgumentCaptor.forClass(AgentExecution.class);
        verify(executionRepository).save(captor.capture());
        String savedOutput = captor.getValue().getOutputSnapshot();

        // 长度应为截断后的 2000 个字符 + "...[truncated]" 后缀
        assertNotNull(savedOutput);
        assertTrue(savedOutput.endsWith("...[truncated]"));
        assertEquals(2000 + "...[truncated]".length(), savedOutput.length());
    }

    @Test
    void completeExecution_noopWhenExecutionNotFound() {
        when(executionRepository.findById(999L)).thenReturn(Optional.empty());

        // 不抛异常，静默忽略
        assertDoesNotThrow(() ->
                service.completeExecution(999L, true, 1000L, null, "output", null));

        verify(executionRepository, never()).save(any());
    }

    // ========== reportFromClient ==========

    @Test
    void reportFromClient_savesExecution() {
        AgentExecutionReport report = new AgentExecutionReport();
        report.setAgentCode("gemini-translate");
        report.setStatus("SUCCESS");
        report.setDurationMs(800L);
        report.setTokenCount(150);
        report.setReferenceType("ticket");
        report.setReferenceId(10L);
        report.setExecutedOn("desktop");
        report.setInputSnapshot("原文内容");
        report.setOutputSnapshot("翻译结果");
        report.setErrorMessage(null);

        when(executionRepository.save(any(AgentExecution.class))).thenAnswer(inv -> inv.getArgument(0));

        service.reportFromClient(report);

        ArgumentCaptor<AgentExecution> captor = ArgumentCaptor.forClass(AgentExecution.class);
        verify(executionRepository).save(captor.capture());
        AgentExecution saved = captor.getValue();
        assertEquals("gemini-translate", saved.getAgentCode());
        assertEquals(ExecutionStatus.SUCCESS, saved.getStatus());
        assertEquals(800L, saved.getDurationMs());
        assertEquals(150, saved.getTokenCount());
        assertEquals("ticket", saved.getReferenceType());
        assertEquals(10L, saved.getReferenceId());
        assertEquals("desktop", saved.getExecutedOn());
        assertEquals("原文内容", saved.getInputSnapshot());
        assertEquals("翻译结果", saved.getOutputSnapshot());
    }

    @Test
    void reportFromClient_parsesStatusString() {
        AgentExecutionReport report = new AgentExecutionReport();
        report.setAgentCode("gemini-translate");
        report.setStatus("TIMEOUT");
        report.setDurationMs(30000L);

        when(executionRepository.save(any(AgentExecution.class))).thenAnswer(inv -> inv.getArgument(0));

        service.reportFromClient(report);

        ArgumentCaptor<AgentExecution> captor = ArgumentCaptor.forClass(AgentExecution.class);
        verify(executionRepository).save(captor.capture());
        assertEquals(ExecutionStatus.TIMEOUT, captor.getValue().getStatus());
    }

    @Test
    void reportFromClient_invalidStatus_defaultsToFailed() {
        AgentExecutionReport report = new AgentExecutionReport();
        report.setAgentCode("gemini-translate");
        report.setStatus("INVALID_STATUS_VALUE");
        report.setDurationMs(100L);

        when(executionRepository.save(any(AgentExecution.class))).thenAnswer(inv -> inv.getArgument(0));

        service.reportFromClient(report);

        ArgumentCaptor<AgentExecution> captor = ArgumentCaptor.forClass(AgentExecution.class);
        verify(executionRepository).save(captor.capture());
        assertEquals(ExecutionStatus.FAILED, captor.getValue().getStatus());
    }

    @Test
    void reportFromClient_truncatesLongInputAndOutput() {
        AgentExecutionReport report = new AgentExecutionReport();
        report.setAgentCode("gemini-translate");
        report.setStatus("SUCCESS");
        report.setInputSnapshot("I".repeat(3000));
        report.setOutputSnapshot("O".repeat(2500));

        when(executionRepository.save(any(AgentExecution.class))).thenAnswer(inv -> inv.getArgument(0));

        service.reportFromClient(report);

        ArgumentCaptor<AgentExecution> captor = ArgumentCaptor.forClass(AgentExecution.class);
        verify(executionRepository).save(captor.capture());
        AgentExecution saved = captor.getValue();

        assertTrue(saved.getInputSnapshot().endsWith("...[truncated]"));
        assertTrue(saved.getOutputSnapshot().endsWith("...[truncated]"));
        assertEquals(2000 + "...[truncated]".length(), saved.getInputSnapshot().length());
        assertEquals(2000 + "...[truncated]".length(), saved.getOutputSnapshot().length());
    }

    // ========== getStatsDashboard ==========

    @Test
    void getStatsDashboard_calculatesCorrectly() {
        when(definitionRepository.findAllByOrderBySortOrder())
                .thenReturn(List.of(translateDef, replyDef));

        // gemini-translate: 10 total, 8 success, 2 failed, avg 1200ms
        when(executionRepository.countByAgentCode("gemini-translate")).thenReturn(10L);
        when(executionRepository.countByAgentCodeAndStatus("gemini-translate", ExecutionStatus.SUCCESS)).thenReturn(8L);
        when(executionRepository.countByAgentCodeAndStatus("gemini-translate", ExecutionStatus.FAILED)).thenReturn(2L);
        when(executionRepository.findAvgDurationByAgentCode("gemini-translate")).thenReturn(1200.0);

        // notebooklm-reply: 5 total, 5 success, 0 failed, avg 3000ms
        when(executionRepository.countByAgentCode("notebooklm-reply")).thenReturn(5L);
        when(executionRepository.countByAgentCodeAndStatus("notebooklm-reply", ExecutionStatus.SUCCESS)).thenReturn(5L);
        when(executionRepository.countByAgentCodeAndStatus("notebooklm-reply", ExecutionStatus.FAILED)).thenReturn(0L);
        when(executionRepository.findAvgDurationByAgentCode("notebooklm-reply")).thenReturn(3000.0);

        List<AgentStats> result = service.getStatsDashboard();

        assertEquals(2, result.size());

        AgentStats translateStats = result.get(0);
        assertEquals("gemini-translate", translateStats.getAgentCode());
        assertEquals("Gemini 翻译", translateStats.getAgentName());
        assertEquals(10L, translateStats.getTotalExecutions());
        assertEquals(8L, translateStats.getSuccessCount());
        assertEquals(2L, translateStats.getFailedCount());
        assertEquals(1200.0, translateStats.getAvgDurationMs());
        // 成功率: 8/10 * 100 = 80.0%
        assertEquals(80.0, translateStats.getSuccessRate());

        AgentStats replyStats = result.get(1);
        assertEquals("notebooklm-reply", replyStats.getAgentCode());
        assertEquals(5L, replyStats.getTotalExecutions());
        assertEquals(5L, replyStats.getSuccessCount());
        assertEquals(3000.0, replyStats.getAvgDurationMs());
        assertEquals(100.0, replyStats.getSuccessRate());
    }

    @Test
    void getStatsDashboard_emptyData() {
        // 有 Agent 定义但无执行记录
        when(definitionRepository.findAllByOrderBySortOrder()).thenReturn(List.of(translateDef));
        when(executionRepository.countByAgentCode("gemini-translate")).thenReturn(0L);
        when(executionRepository.countByAgentCodeAndStatus("gemini-translate", ExecutionStatus.SUCCESS)).thenReturn(0L);
        when(executionRepository.countByAgentCodeAndStatus("gemini-translate", ExecutionStatus.FAILED)).thenReturn(0L);
        when(executionRepository.findAvgDurationByAgentCode("gemini-translate")).thenReturn(null);

        List<AgentStats> result = service.getStatsDashboard();

        assertEquals(1, result.size());
        AgentStats stats = result.get(0);
        assertEquals(0L, stats.getTotalExecutions());
        assertEquals(0L, stats.getSuccessCount());
        // avgDuration null 时应返回 0
        assertEquals(0.0, stats.getAvgDurationMs());
        // 无执行时成功率应为 0
        assertEquals(0.0, stats.getSuccessRate());
    }

    @Test
    void getStatsDashboard_noDefinitions_returnsEmptyList() {
        when(definitionRepository.findAllByOrderBySortOrder()).thenReturn(Collections.emptyList());

        List<AgentStats> result = service.getStatsDashboard();

        assertTrue(result.isEmpty());
        verify(executionRepository, never()).countByAgentCode(any());
    }
}
