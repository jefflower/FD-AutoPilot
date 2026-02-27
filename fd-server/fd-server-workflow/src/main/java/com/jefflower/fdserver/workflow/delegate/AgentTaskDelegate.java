package com.jefflower.fdserver.workflow.delegate;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ai.dto.AgentExecuteResult;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.service.AgentDefinitionService;
import com.jefflower.fdserver.ai.service.AgentDispatchService;
import com.jefflower.fdserver.task.enums.TriggerType;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import com.jefflower.fdserver.workflow.service.WorkflowCallbackRegistry;
import org.flowable.bpmn.model.FieldExtension;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.ServiceTask;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * BPMN ServiceTask 桥接 — Agent 执行。
 * <p>
 * 从 BPMN FieldExtension 或流程变量读取 agentCode，根据 executionEnv 决定：
 * <ul>
 *   <li>CLIENT_ONLY → 创建 TaskInstance，设置 pendingTaskType 变量，后续 ReceiveTask 等待</li>
 *   <li>SERVER_ONLY / BOTH → 服务端同步执行，结果写入流程变量，pendingTaskType 置 null</li>
 * </ul>
 * <p>
 * 如果 Agent 定义了 inputSchema，会根据 Schema 自动从业务数据和流程变量中构建结构化输入。
 */
@Component("agentTaskDelegate")
public class AgentTaskDelegate implements JavaDelegate {

    private static final Logger log = LoggerFactory.getLogger(AgentTaskDelegate.class);

    private final AgentDefinitionService agentDefinitionService;
    private final AgentDispatchService agentDispatchService;
    private final TaskDistributionService taskDistributionService;
    private final WorkflowCallbackRegistry callbackRegistry;
    private final ObjectMapper objectMapper;

    public AgentTaskDelegate(AgentDefinitionService agentDefinitionService,
                             AgentDispatchService agentDispatchService,
                             TaskDistributionService taskDistributionService,
                             WorkflowCallbackRegistry callbackRegistry,
                             ObjectMapper objectMapper) {
        this.agentDefinitionService = agentDefinitionService;
        this.agentDispatchService = agentDispatchService;
        this.taskDistributionService = taskDistributionService;
        this.callbackRegistry = callbackRegistry;
        this.objectMapper = objectMapper;
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
            String taskType = getFieldValueOrDefault(execution, "taskType", "workflow.agent." + agentCode);
            String payload = buildPayload(execution, agentCode, def);

            taskDistributionService.createTask(
                    taskType, "ticket", businessKey, payload, TriggerType.EVENT);

            // 使用 execution-local 变量，避免并行网关中不同分支共享变量导致互相覆盖
            execution.setVariableLocal("pendingTaskType", taskType);
            log.info("[AgentTaskDelegate] CLIENT_ONLY: created task type={}, businessKey={}, executionId={}",
                    taskType, businessKey, execution.getId());

            // 触发可选的 startCallback（通知业务模块 Agent 任务已创建，如设置"进行中"状态）
            String startCallback = getFieldValueOrDefault(execution, "startCallback", null);
            if (startCallback != null) {
                try {
                    callbackRegistry.executeCallback(startCallback, businessKey, Map.of());
                } catch (Exception e) {
                    log.warn("[AgentTaskDelegate] startCallback '{}' failed for businessKey={}: {}",
                            startCallback, businessKey, e.getMessage());
                }
            }
        } else {
            // SERVER_ONLY / BOTH：服务端同步执行
            execution.setVariableLocal("pendingTaskType", null);

            // 尝试构建结构化输入
            Map<String, Object> structuredInput = buildStructuredInput(execution, def);
            AgentExecuteResult result;
            if (structuredInput != null) {
                result = agentDispatchService.executeOnServer(
                        agentCode, structuredInput, "ticket", parseLongOrNull(businessKey), "workflow");
            } else {
                String input = (String) execution.getVariable("agentInput");
                result = agentDispatchService.executeOnServer(
                        agentCode, input, "ticket", parseLongOrNull(businessKey), "workflow");
            }

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

    /**
     * 从 BPMN FieldExtension 或流程变量读取字段值，无值时返回 defaultValue（不抛异常）
     */
    static String getFieldValueOrDefault(DelegateExecution execution, String fieldName, String defaultValue) {
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
        Object varValue = execution.getVariable(fieldName);
        if (varValue != null) return varValue.toString();
        return defaultValue;
    }

    /**
     * 根据 inputSchema 自动构建结构化输入。
     * 如果 Agent 没有 inputSchema 或构建失败，返回 null，走旧路径。
     */
    private Map<String, Object> buildStructuredInput(DelegateExecution execution, AgentDefinition def) {
        String inputSchema = def.getInputSchema();
        if (inputSchema == null || inputSchema.isBlank()) return null;

        try {
            Map<String, Object> input = new HashMap<>();
            String businessKey = execution.getProcessInstanceBusinessKey();

            // 如果 schema 需要 ticket 数据
            if (inputSchema.contains("\"ticket\"")) {
                Map<String, Object> ticketData = callbackRegistry.getBusinessData("ticket", businessKey);
                if (!ticketData.isEmpty()) {
                    input.put("ticket", ticketData);
                }
            }

            // 从流程变量读取其他参数
            if (inputSchema.contains("\"targetLang\"")) {
                Object targetLang = execution.getVariable("targetLang");
                if (targetLang != null) input.put("targetLang", targetLang.toString());
            }
            if (inputSchema.contains("\"lastAuditRemark\"")) {
                Object remark = execution.getVariable("lastAuditRemark");
                if (remark != null) input.put("lastAuditRemark", remark.toString());
            }
            if (inputSchema.contains("\"trackingNumbers\"")) {
                Object numbers = execution.getVariable("trackingNumbers");
                if (numbers != null) input.put("trackingNumbers", numbers);
            }

            return input.isEmpty() ? null : input;
        } catch (Exception e) {
            log.warn("[AgentTaskDelegate] Failed to build structured input for agent {}: {}",
                    def.getCode(), e.getMessage());
            return null;
        }
    }

    /**
     * 构建 CLIENT_ONLY payload（含 agentInput）
     */
    private String buildPayload(DelegateExecution execution, String agentCode, AgentDefinition def) {
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("processInstanceId", execution.getProcessInstanceId());
            payload.put("waitActivityId", execution.getCurrentActivityId() + "_wait");
            payload.put("agentCode", agentCode);
            payload.put("businessKey", execution.getProcessInstanceBusinessKey());

            // 前端消费者所需的工单信息（避免 "Unknown Subject"）
            String businessKey = execution.getProcessInstanceBusinessKey();
            payload.put("ticketId", parseLongOrNull(businessKey));
            Map<String, Object> ticketData = callbackRegistry.getBusinessData("ticket", businessKey);
            if (ticketData.containsKey("subject")) {
                payload.put("subject", ticketData.get("subject"));
            }
            payload.put("externalId", businessKey);

            // 如果有 inputSchema，添加结构化输入数据
            Map<String, Object> agentInput = buildStructuredInput(execution, def);
            if (agentInput != null) {
                payload.put("agentInput", agentInput);
            }

            return objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            log.warn("[AgentTaskDelegate] Failed to build JSON payload, falling back to simple format", e);
            return String.format(
                    "{\"processInstanceId\":\"%s\",\"waitActivityId\":\"%s\",\"agentCode\":\"%s\",\"businessKey\":\"%s\"}",
                    execution.getProcessInstanceId(),
                    execution.getCurrentActivityId() + "_wait",
                    agentCode,
                    execution.getProcessInstanceBusinessKey()
            );
        }
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
