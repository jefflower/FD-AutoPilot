package com.jefflower.fdserver.workflow.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.workflow.entity.WorkflowDefinition;
import com.jefflower.fdserver.workflow.event.WorkflowStatusEvent;
import com.jefflower.fdserver.workflow.repository.WorkflowDefinitionRepository;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.repository.Deployment;
import org.flowable.engine.repository.ProcessDefinition;
import org.flowable.engine.runtime.Execution;
import org.flowable.engine.runtime.ProcessInstance;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;

@Service
public class WorkflowService {

    private static final Logger log = LoggerFactory.getLogger(WorkflowService.class);

    private final RepositoryService repositoryService;
    private final RuntimeService runtimeService;
    private final WorkflowDefinitionRepository definitionRepository;
    private final ApplicationEventPublisher eventPublisher;

    public WorkflowService(RepositoryService repositoryService,
                           RuntimeService runtimeService,
                           WorkflowDefinitionRepository definitionRepository,
                           ApplicationEventPublisher eventPublisher) {
        this.repositoryService = repositoryService;
        this.runtimeService = runtimeService;
        this.definitionRepository = definitionRepository;
        this.eventPublisher = eventPublisher;
    }

    /**
     * 部署 BPMN XML 到 Flowable，回填 deploymentId 和 processDefinitionId
     */
    @Transactional
    public void deployDefinition(Long definitionId) {
        WorkflowDefinition def = definitionRepository.findById(definitionId)
                .orElseThrow(() -> new BusinessException(ErrorCode.WORKFLOW_NOT_FOUND));

        if (def.getBpmnXml() == null || def.getBpmnXml().isBlank()) {
            throw new BusinessException(ErrorCode.WORKFLOW_DEPLOY_FAILED, "BPMN XML 为空");
        }

        try {
            String resourceName = def.getProcessKey() + ".bpmn20.xml";
            Deployment deployment = repositoryService.createDeployment()
                    .name(def.getName())
                    .addString(resourceName, def.getBpmnXml())
                    .deploy();

            ProcessDefinition processDef = repositoryService.createProcessDefinitionQuery()
                    .deploymentId(deployment.getId())
                    .singleResult();

            def.setDeploymentId(deployment.getId());
            def.setProcessDefinitionId(processDef.getId());
            definitionRepository.save(def);

            log.info("[WorkflowService] Deployed workflow: key={}, deploymentId={}, processDefId={}",
                    def.getProcessKey(), deployment.getId(), processDef.getId());
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("[WorkflowService] Deploy failed for key={}", def.getProcessKey(), e);
            throw new BusinessException(ErrorCode.WORKFLOW_DEPLOY_FAILED, e.getMessage());
        }
    }

    /**
     * 启动流程实例
     */
    public String startProcess(String processKey, String businessKey, Map<String, Object> vars) {
        ProcessInstance instance = runtimeService.startProcessInstanceByKey(processKey, businessKey, vars);
        log.info("[WorkflowService] Started process: key={}, businessKey={}, instanceId={}",
                processKey, businessKey, instance.getId());

        eventPublisher.publishEvent(new WorkflowStatusEvent(
                this, instance.getId(), businessKey, null, "process-started"));

        return instance.getId();
    }

    /**
     * 唤醒 ReceiveTask
     * <p>
     * 必须运行在事务中：trigger 会驱动 BPMN 流程继续执行，
     * 后续 JavaDelegate / BusinessCallback 可能包含 JPA 写操作（如 ticketRepository.save）。
     * 当从 @TransactionalEventListener(AFTER_COMMIT) 调用时，原始事务已提交，
     * 需要此处声明 @Transactional 创建新事务。
     */
    @Transactional
    public void signalReceiveTask(String processInstanceId, String activityId, Map<String, Object> vars) {
        Execution execution = runtimeService.createExecutionQuery()
                .processInstanceId(processInstanceId)
                .activityId(activityId)
                .singleResult();

        if (execution == null) {
            throw new BusinessException(ErrorCode.WORKFLOW_SIGNAL_FAILED,
                    "ReceiveTask not found: processInstanceId=" + processInstanceId + ", activityId=" + activityId);
        }

        if (vars != null && !vars.isEmpty()) {
            runtimeService.setVariables(execution.getId(), vars);
        }
        runtimeService.trigger(execution.getId());

        log.info("[WorkflowService] Signaled ReceiveTask: processInstanceId={}, activityId={}",
                processInstanceId, activityId);

        // 获取 businessKey 用于前端关联
        ProcessInstance pi = runtimeService.createProcessInstanceQuery()
                .processInstanceId(processInstanceId)
                .singleResult();
        String businessKey = pi != null ? pi.getBusinessKey() : null;
        eventPublisher.publishEvent(new WorkflowStatusEvent(
                this, processInstanceId, businessKey, activityId, "node-completed"));
    }

    /**
     * 查询是否有活跃流程
     */
    public boolean isProcessRunning(String businessKey) {
        long count = runtimeService.createProcessInstanceQuery()
                .processInstanceBusinessKey(businessKey)
                .active()
                .count();
        return count > 0;
    }

    /**
     * 获取流程实例的活跃节点 ID 列表
     */
    public List<String> getActiveActivityIds(String processInstanceId) {
        List<Execution> executions = runtimeService.createExecutionQuery()
                .processInstanceId(processInstanceId)
                .list();

        return executions.stream()
                .map(Execution::getActivityId)
                .filter(id -> id != null)
                .toList();
    }

    /**
     * 终止流程实例
     */
    public void terminateProcess(String processInstanceId, String reason) {
        try {
            runtimeService.deleteProcessInstance(processInstanceId, reason);
            log.info("[WorkflowService] Terminated process: instanceId={}, reason={}", processInstanceId, reason);
        } catch (Exception e) {
            log.error("[WorkflowService] Terminate failed: instanceId={}", processInstanceId, e);
            throw new BusinessException(ErrorCode.WORKFLOW_SIGNAL_FAILED, "终止流程失败: " + e.getMessage());
        }
    }

    /**
     * 获取流程实例 ID（通过 businessKey 查找）
     */
    public String getProcessInstanceId(String businessKey) {
        ProcessInstance instance = runtimeService.createProcessInstanceQuery()
                .processInstanceBusinessKey(businessKey)
                .active()
                .singleResult();
        return instance != null ? instance.getId() : null;
    }

    /**
     * 查询所有在指定超时之前启动且当前停留在 ReceiveTask 上的流程实例。
     * 用于超时检测：找出可能卡死的流程。
     *
     * @param startedBefore 流程启动时间早于此值的才算超时
     * @return 超时的流程实例列表（包含 businessKey 和当前活跃节点信息）
     */
    public List<ProcessInstance> findStuckProcessInstances(Instant startedBefore) {
        return runtimeService.createProcessInstanceQuery()
                .active()
                .startedBefore(Date.from(startedBefore))
                .list();
    }

    /**
     * 查询指定流程实例中，停留在某个 ReceiveTask 上的执行。
     */
    public Execution findReceiveTaskExecution(String processInstanceId, String activityId) {
        return runtimeService.createExecutionQuery()
                .processInstanceId(processInstanceId)
                .activityId(activityId)
                .singleResult();
    }
}
