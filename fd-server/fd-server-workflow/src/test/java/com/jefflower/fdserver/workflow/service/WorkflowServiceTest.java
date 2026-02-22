package com.jefflower.fdserver.workflow.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.workflow.entity.WorkflowDefinition;
import com.jefflower.fdserver.workflow.event.WorkflowStatusEvent;
import com.jefflower.fdserver.workflow.repository.WorkflowDefinitionRepository;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.repository.Deployment;
import org.flowable.engine.repository.DeploymentBuilder;
import org.flowable.engine.repository.ProcessDefinition;
import org.flowable.engine.repository.ProcessDefinitionQuery;
import org.flowable.engine.runtime.Execution;
import org.flowable.engine.runtime.ExecutionQuery;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.engine.runtime.ProcessInstanceQuery;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class WorkflowServiceTest {

    @Mock
    private RepositoryService repositoryService;

    @Mock
    private RuntimeService runtimeService;

    @Mock
    private WorkflowDefinitionRepository definitionRepository;

    @Mock
    private ApplicationEventPublisher eventPublisher;

    @InjectMocks
    private WorkflowService workflowService;

    // Flowable API mock 链
    @Mock
    private DeploymentBuilder deploymentBuilder;

    @Mock
    private Deployment deployment;

    @Mock
    private ProcessDefinitionQuery processDefinitionQuery;

    @Mock
    private ProcessDefinition processDefinition;

    @Mock
    private ProcessInstanceQuery processInstanceQuery;

    @Mock
    private ProcessInstance processInstance;

    @Mock
    private ExecutionQuery executionQuery;

    @Mock
    private Execution execution;

    private WorkflowDefinition definition;

    @BeforeEach
    void setUp() {
        definition = new WorkflowDefinition();
        definition.setId(1L);
        definition.setProcessKey("ticket-standard-flow");
        definition.setName("工单标准流程");
        definition.setBpmnXml("<definitions>...</definitions>");
        definition.setBusinessType("ticket");
        definition.setEnabled(true);
    }

    // ========== deployDefinition ==========

    @Test
    void deployDefinition_success() {
        // given
        when(definitionRepository.findById(1L)).thenReturn(Optional.of(definition));

        // 链式 DeploymentBuilder mock
        when(repositoryService.createDeployment()).thenReturn(deploymentBuilder);
        when(deploymentBuilder.name(anyString())).thenReturn(deploymentBuilder);
        when(deploymentBuilder.addString(anyString(), anyString())).thenReturn(deploymentBuilder);
        when(deploymentBuilder.deploy()).thenReturn(deployment);
        when(deployment.getId()).thenReturn("deploy-001");

        // ProcessDefinitionQuery mock
        when(repositoryService.createProcessDefinitionQuery()).thenReturn(processDefinitionQuery);
        when(processDefinitionQuery.deploymentId("deploy-001")).thenReturn(processDefinitionQuery);
        when(processDefinitionQuery.singleResult()).thenReturn(processDefinition);
        when(processDefinition.getId()).thenReturn("procDef-001");

        when(definitionRepository.save(any(WorkflowDefinition.class))).thenAnswer(i -> i.getArgument(0));

        // when
        workflowService.deployDefinition(1L);

        // then — 回填了 deploymentId 和 processDefinitionId
        ArgumentCaptor<WorkflowDefinition> captor = ArgumentCaptor.forClass(WorkflowDefinition.class);
        verify(definitionRepository).save(captor.capture());
        assertEquals("deploy-001", captor.getValue().getDeploymentId());
        assertEquals("procDef-001", captor.getValue().getProcessDefinitionId());
    }

    @Test
    void deployDefinition_definitionNotFound_throwsException() {
        // given
        when(definitionRepository.findById(999L)).thenReturn(Optional.empty());

        // when / then
        BusinessException ex = assertThrows(BusinessException.class,
                () -> workflowService.deployDefinition(999L));
        assertEquals(ErrorCode.WORKFLOW_NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void deployDefinition_emptyBpmnXml_throwsException() {
        // given — BPMN XML 为空
        definition.setBpmnXml("");
        when(definitionRepository.findById(1L)).thenReturn(Optional.of(definition));

        // when / then
        BusinessException ex = assertThrows(BusinessException.class,
                () -> workflowService.deployDefinition(1L));
        assertEquals(ErrorCode.WORKFLOW_DEPLOY_FAILED, ex.getErrorCode());
    }

    @Test
    void deployDefinition_nullBpmnXml_throwsException() {
        // given — BPMN XML 为 null
        definition.setBpmnXml(null);
        when(definitionRepository.findById(1L)).thenReturn(Optional.of(definition));

        // when / then
        BusinessException ex = assertThrows(BusinessException.class,
                () -> workflowService.deployDefinition(1L));
        assertEquals(ErrorCode.WORKFLOW_DEPLOY_FAILED, ex.getErrorCode());
    }

    @Test
    void deployDefinition_flowableThrows_wrapsAsBusinessException() {
        // given — Flowable 部署时抛出运行时异常
        when(definitionRepository.findById(1L)).thenReturn(Optional.of(definition));
        when(repositoryService.createDeployment()).thenReturn(deploymentBuilder);
        when(deploymentBuilder.name(anyString())).thenReturn(deploymentBuilder);
        when(deploymentBuilder.addString(anyString(), anyString())).thenReturn(deploymentBuilder);
        when(deploymentBuilder.deploy()).thenThrow(new RuntimeException("Flowable engine error"));

        // when / then
        BusinessException ex = assertThrows(BusinessException.class,
                () -> workflowService.deployDefinition(1L));
        assertEquals(ErrorCode.WORKFLOW_DEPLOY_FAILED, ex.getErrorCode());
    }

    // ========== startProcess ==========

    @Test
    void startProcess_success_returnsProcessInstanceId() {
        // given
        // 注意：startProcess 的 businessKey 来自方法参数，不从 processInstance.getBusinessKey() 取
        when(runtimeService.startProcessInstanceByKey(
                eq("ticket-standard-flow"), eq("ticket-42"), any(Map.class)))
                .thenReturn(processInstance);
        when(processInstance.getId()).thenReturn("proc-inst-001");

        Map<String, Object> vars = Map.of("lang", "zh-CN");

        // when
        String instanceId = workflowService.startProcess("ticket-standard-flow", "ticket-42", vars);

        // then
        assertEquals("proc-inst-001", instanceId);

        // 验证发布了 process-started 事件
        ArgumentCaptor<WorkflowStatusEvent> eventCaptor = ArgumentCaptor.forClass(WorkflowStatusEvent.class);
        verify(eventPublisher).publishEvent(eventCaptor.capture());
        WorkflowStatusEvent event = eventCaptor.getValue();
        assertEquals("proc-inst-001", event.getProcessInstanceId());
        assertEquals("ticket-42", event.getBusinessKey());
        assertEquals("process-started", event.getStatus());
        assertNull(event.getCurrentActivityId());
    }

    @Test
    void startProcess_success_withNullVars() {
        // given
        when(runtimeService.startProcessInstanceByKey(
                eq("ticket-standard-flow"), eq("ticket-1"), isNull()))
                .thenReturn(processInstance);
        when(processInstance.getId()).thenReturn("proc-inst-002");

        // when
        String instanceId = workflowService.startProcess("ticket-standard-flow", "ticket-1", null);

        // then
        assertEquals("proc-inst-002", instanceId);
        verify(eventPublisher).publishEvent(any(WorkflowStatusEvent.class));
    }

    // ========== signalReceiveTask ==========

    @Test
    void signalReceiveTask_success() {
        // given
        when(runtimeService.createExecutionQuery()).thenReturn(executionQuery);
        when(executionQuery.processInstanceId("proc-inst-001")).thenReturn(executionQuery);
        when(executionQuery.activityId("receiveTranslation")).thenReturn(executionQuery);
        when(executionQuery.singleResult()).thenReturn(execution);
        when(execution.getId()).thenReturn("exec-001");

        // 查询 processInstance 获取 businessKey
        when(runtimeService.createProcessInstanceQuery()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.processInstanceId("proc-inst-001")).thenReturn(processInstanceQuery);
        when(processInstanceQuery.singleResult()).thenReturn(processInstance);
        when(processInstance.getBusinessKey()).thenReturn("ticket-42");

        Map<String, Object> vars = Map.of("translationResult", "translated");

        // when
        workflowService.signalReceiveTask("proc-inst-001", "receiveTranslation", vars);

        // then
        verify(runtimeService).setVariables("exec-001", vars);
        verify(runtimeService).trigger("exec-001");

        // 验证发布了 node-completed 事件
        ArgumentCaptor<WorkflowStatusEvent> eventCaptor = ArgumentCaptor.forClass(WorkflowStatusEvent.class);
        verify(eventPublisher).publishEvent(eventCaptor.capture());
        WorkflowStatusEvent event = eventCaptor.getValue();
        assertEquals("proc-inst-001", event.getProcessInstanceId());
        assertEquals("ticket-42", event.getBusinessKey());
        assertEquals("receiveTranslation", event.getCurrentActivityId());
        assertEquals("node-completed", event.getStatus());
    }

    @Test
    void signalReceiveTask_emptyVars_skipsSetVariables() {
        // given — vars 为空 Map，不调用 setVariables
        when(runtimeService.createExecutionQuery()).thenReturn(executionQuery);
        when(executionQuery.processInstanceId("proc-inst-001")).thenReturn(executionQuery);
        when(executionQuery.activityId("receiveReply")).thenReturn(executionQuery);
        when(executionQuery.singleResult()).thenReturn(execution);
        when(execution.getId()).thenReturn("exec-002");

        when(runtimeService.createProcessInstanceQuery()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.processInstanceId("proc-inst-001")).thenReturn(processInstanceQuery);
        when(processInstanceQuery.singleResult()).thenReturn(null);

        // when
        workflowService.signalReceiveTask("proc-inst-001", "receiveReply", Map.of());

        // then — vars 为空，不调用 setVariables；trigger 仍然调用
        verify(runtimeService, never()).setVariables(anyString(), anyMap());
        verify(runtimeService).trigger("exec-002");
    }

    @Test
    void signalReceiveTask_nullVars_skipsSetVariables() {
        // given
        when(runtimeService.createExecutionQuery()).thenReturn(executionQuery);
        when(executionQuery.processInstanceId("proc-inst-001")).thenReturn(executionQuery);
        when(executionQuery.activityId("receiveAudit")).thenReturn(executionQuery);
        when(executionQuery.singleResult()).thenReturn(execution);
        when(execution.getId()).thenReturn("exec-003");

        when(runtimeService.createProcessInstanceQuery()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.processInstanceId("proc-inst-001")).thenReturn(processInstanceQuery);
        when(processInstanceQuery.singleResult()).thenReturn(null);

        // when
        workflowService.signalReceiveTask("proc-inst-001", "receiveAudit", null);

        // then — null vars 不调用 setVariables
        verify(runtimeService, never()).setVariables(anyString(), anyMap());
        verify(runtimeService).trigger("exec-003");
    }

    @Test
    void signalReceiveTask_executionNotFound_throwsException() {
        // given — 找不到 Execution
        when(runtimeService.createExecutionQuery()).thenReturn(executionQuery);
        when(executionQuery.processInstanceId("proc-inst-999")).thenReturn(executionQuery);
        when(executionQuery.activityId("receiveTranslation")).thenReturn(executionQuery);
        when(executionQuery.singleResult()).thenReturn(null);

        // when / then
        BusinessException ex = assertThrows(BusinessException.class, () ->
                workflowService.signalReceiveTask("proc-inst-999", "receiveTranslation", Map.of())
        );
        assertEquals(ErrorCode.WORKFLOW_SIGNAL_FAILED, ex.getErrorCode());

        // trigger 不应被调用
        verify(runtimeService, never()).trigger(anyString());
    }

    @Test
    void signalReceiveTask_processInstanceNotFound_businessKeyIsNull() {
        // given — Execution 存在，但 ProcessInstance 找不到（流程已结束）
        when(runtimeService.createExecutionQuery()).thenReturn(executionQuery);
        when(executionQuery.processInstanceId("proc-inst-001")).thenReturn(executionQuery);
        when(executionQuery.activityId("receiveTranslation")).thenReturn(executionQuery);
        when(executionQuery.singleResult()).thenReturn(execution);
        when(execution.getId()).thenReturn("exec-001");

        when(runtimeService.createProcessInstanceQuery()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.processInstanceId("proc-inst-001")).thenReturn(processInstanceQuery);
        when(processInstanceQuery.singleResult()).thenReturn(null); // ProcessInstance 不存在

        // when — 不应抛出异常，businessKey 为 null 时正常发事件
        assertDoesNotThrow(() ->
                workflowService.signalReceiveTask("proc-inst-001", "receiveTranslation", Map.of())
        );

        verify(eventPublisher).publishEvent(any(WorkflowStatusEvent.class));
    }

    // ========== isProcessRunning ==========

    @Test
    void isProcessRunning_returnsTrue() {
        // given
        when(runtimeService.createProcessInstanceQuery()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.processInstanceBusinessKey("ticket-42")).thenReturn(processInstanceQuery);
        when(processInstanceQuery.active()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.count()).thenReturn(1L);

        // when
        boolean result = workflowService.isProcessRunning("ticket-42");

        // then
        assertTrue(result);
    }

    @Test
    void isProcessRunning_returnsFalse() {
        // given — 没有活跃流程
        when(runtimeService.createProcessInstanceQuery()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.processInstanceBusinessKey("ticket-99")).thenReturn(processInstanceQuery);
        when(processInstanceQuery.active()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.count()).thenReturn(0L);

        // when
        boolean result = workflowService.isProcessRunning("ticket-99");

        // then
        assertFalse(result);
    }

    // ========== terminateProcess ==========

    @Test
    void terminateProcess_success() {
        // given — deleteProcessInstance 正常执行

        // when
        workflowService.terminateProcess("proc-inst-001", "manual-stop");

        // then
        verify(runtimeService).deleteProcessInstance("proc-inst-001", "manual-stop");
    }

    @Test
    void terminateProcess_flowableThrows_wrapsAsBusinessException() {
        // given
        doThrow(new RuntimeException("process not found in engine"))
                .when(runtimeService).deleteProcessInstance("proc-inst-999", "test");

        // when / then
        BusinessException ex = assertThrows(BusinessException.class, () ->
                workflowService.terminateProcess("proc-inst-999", "test")
        );
        assertEquals(ErrorCode.WORKFLOW_SIGNAL_FAILED, ex.getErrorCode());
        assertTrue(ex.getMessage().contains("终止流程失败"));
    }

    // ========== getActiveActivityIds ==========

    @Test
    void getActiveActivityIds_returnsIds() {
        // given
        Execution exec1 = mock(Execution.class);
        Execution exec2 = mock(Execution.class);
        Execution exec3 = mock(Execution.class); // activityId 为 null（根执行）

        when(exec1.getActivityId()).thenReturn("receiveTranslation");
        when(exec2.getActivityId()).thenReturn("humanAudit");
        when(exec3.getActivityId()).thenReturn(null);

        when(runtimeService.createExecutionQuery()).thenReturn(executionQuery);
        when(executionQuery.processInstanceId("proc-inst-001")).thenReturn(executionQuery);
        when(executionQuery.list()).thenReturn(List.of(exec1, exec2, exec3));

        // when
        List<String> ids = workflowService.getActiveActivityIds("proc-inst-001");

        // then — null activityId 被过滤
        assertEquals(2, ids.size());
        assertTrue(ids.contains("receiveTranslation"));
        assertTrue(ids.contains("humanAudit"));
    }

    @Test
    void getActiveActivityIds_emptyList_whenNoExecutions() {
        // given
        when(runtimeService.createExecutionQuery()).thenReturn(executionQuery);
        when(executionQuery.processInstanceId("proc-inst-999")).thenReturn(executionQuery);
        when(executionQuery.list()).thenReturn(List.of());

        // when
        List<String> ids = workflowService.getActiveActivityIds("proc-inst-999");

        // then
        assertTrue(ids.isEmpty());
    }

    // ========== getProcessInstanceId ==========

    @Test
    void getProcessInstanceId_returnsId() {
        // given
        when(runtimeService.createProcessInstanceQuery()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.processInstanceBusinessKey("ticket-42")).thenReturn(processInstanceQuery);
        when(processInstanceQuery.active()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.singleResult()).thenReturn(processInstance);
        when(processInstance.getId()).thenReturn("proc-inst-001");

        // when
        String result = workflowService.getProcessInstanceId("ticket-42");

        // then
        assertEquals("proc-inst-001", result);
    }

    @Test
    void getProcessInstanceId_notFound_returnsNull() {
        // given — 没有活跃流程实例
        when(runtimeService.createProcessInstanceQuery()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.processInstanceBusinessKey("ticket-99")).thenReturn(processInstanceQuery);
        when(processInstanceQuery.active()).thenReturn(processInstanceQuery);
        when(processInstanceQuery.singleResult()).thenReturn(null);

        // when
        String result = workflowService.getProcessInstanceId("ticket-99");

        // then
        assertNull(result);
    }
}
