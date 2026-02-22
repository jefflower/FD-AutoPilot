package com.jefflower.fdserver.workflow.delegate;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.service.AgentDefinitionService;
import com.jefflower.fdserver.ai.service.AgentDispatchService;
import com.jefflower.fdserver.task.enums.TriggerType;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import org.flowable.bpmn.model.FieldExtension;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.ServiceTask;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * BPMN ServiceTask 桥接 — Agent 执行。
 * <p>
 * 从 BPMN FieldExtension 或流程变量读取 agentCode，根据 executionEnv 决定：
 * <ul>
 *   <li>CLIENT_ONLY → 创建 TaskInstance，设置 pendingTaskType 变量，后续 ReceiveTask 等待</li>
 *   <li>SERVER_ONLY / BOTH → 服务端同步执行，结果写入流程变量，pendingTaskType 置 null</li>
 * </ul>
 */
@Component("agentTaskDelegate")
public class AgentTaskDelegate implements JavaDelegate {

    private static final Logger log = LoggerFactory.getLogger(AgentTaskDelegate.class);

    private final AgentDefinitionService agentDefinitionService;
    private final AgentDispatchService agentDispatchService;
    private final TaskDistributionService taskDistributionService;

    public AgentTaskDelegate(AgentDefinitionService agentDefinitionService,
                             AgentDispatchService agentDispatchService,
                             TaskDistributionService taskDistributionService) {
        this.agentDefinitionService = agentDefinitionService;
        this.agentDispatchService = agentDispatchService;
        this.taskDistributionService = taskDistributionService;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String agentCode = getFieldValue(execution, "agentCode");
        String businessKey = execution.getProcessInstanceBusinessKey();

        log.info("[AgentTaskDelegate] Executing agent={}, businessKey={}, activityId={}",
                agentCode, businessKey, execution.getCurrentActivityId());

        AgentDefinition def = agentDefinitionService.findByCode(agentCode)
                .orElseThrow(() -> new RuntimeException("Agent not found: " + agentCode));

        if (def.getExecutionEnv() == ExecutionEnv.CLIENT_ONLY) {
            // CLIENT_ONLY：创建 TaskInstance，流程将在后续 ReceiveTask 暂停
            String taskType = "workflow.agent." + agentCode;
            String payload = buildPayload(execution, agentCode);

            taskDistributionService.createTask(
                    taskType, "ticket", businessKey, payload, TriggerType.EVENT);

            execution.setVariable("pendingTaskType", taskType);
            log.info("[AgentTaskDelegate] CLIENT_ONLY: created task type={}, businessKey={}", taskType, businessKey);
        } else {
            // SERVER_ONLY / BOTH：服务端同步执行
            execution.setVariable("pendingTaskType", null);

            String input = (String) execution.getVariable("agentInput");
            var result = agentDispatchService.executeOnServer(
                    agentCode, input, "ticket", parseLongOrNull(businessKey), "workflow");

            execution.setVariable("agentSuccess", result.isSuccess());
            execution.setVariable("agentResult", result.getOutput());
            if (!result.isSuccess()) {
                execution.setVariable("agentError", result.getErrorMessage());
            }
            log.info("[AgentTaskDelegate] SERVER executed agent={}, success={}", agentCode, result.isSuccess());
        }
    }

    /**
     * 从 BPMN FieldExtension 或流程变量读取字段值
     */
    static String getFieldValue(DelegateExecution execution, String fieldName) {
        // 1. 从 BPMN FieldExtension 读取（ServiceTask 节点上的 flowable:field 配置）
        FlowElement flowElement = execution.getCurrentFlowElement();
        if (flowElement instanceof ServiceTask serviceTask) {
            for (FieldExtension field : serviceTask.getFieldExtensions()) {
                if (fieldName.equals(field.getFieldName())) {
                    String value = field.getStringValue();
                    if (value != null && !value.isEmpty()) return value;
                    if (field.getExpression() != null && !field.getExpression().isEmpty()) {
                        return field.getExpression();
                    }
                }
            }
        }

        // 2. 从流程变量读取（运行时覆盖）
        Object varValue = execution.getVariable(fieldName);
        if (varValue != null) return varValue.toString();

        throw new RuntimeException("Required field '" + fieldName + "' not found in activity: "
                + execution.getCurrentActivityId());
    }

    private String buildPayload(DelegateExecution execution, String agentCode) {
        return String.format(
                "{\"processInstanceId\":\"%s\",\"waitActivityId\":\"%s\",\"agentCode\":\"%s\",\"businessKey\":\"%s\"}",
                execution.getProcessInstanceId(),
                execution.getCurrentActivityId() + "_wait",
                agentCode,
                execution.getProcessInstanceBusinessKey()
        );
    }

    private Long parseLongOrNull(String value) {
        if (value == null) return null;
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
