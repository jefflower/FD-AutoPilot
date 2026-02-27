package com.jefflower.fdserver.workflow.delegate;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.task.enums.TriggerType;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import com.jefflower.fdserver.workflow.service.WorkflowCallbackRegistry;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * BPMN ServiceTask 桥接 — 创建人工任务。
 * <p>
 * 从 BPMN FieldExtension 读取 humanTaskType（如 "ticket.audit"），
 * 创建 TaskInstance，流程进入后续 ReceiveTask 等待人工完成信号。
 */
@Component("humanTaskDelegate")
public class HumanTaskDelegate implements JavaDelegate {

    private static final Logger log = LoggerFactory.getLogger(HumanTaskDelegate.class);

    private final TaskDistributionService taskDistributionService;
    private final WorkflowCallbackRegistry callbackRegistry;
    private final ObjectMapper objectMapper;

    public HumanTaskDelegate(TaskDistributionService taskDistributionService,
                             WorkflowCallbackRegistry callbackRegistry,
                             ObjectMapper objectMapper) {
        this.taskDistributionService = taskDistributionService;
        this.callbackRegistry = callbackRegistry;
        this.objectMapper = objectMapper;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String humanTaskType = AgentTaskDelegate.getFieldValue(execution, "humanTaskType");
        String businessKey = execution.getProcessInstanceBusinessKey();

        log.info("[HumanTaskDelegate] Creating human task type={}, businessKey={}", humanTaskType, businessKey);

        String payload = buildPayload(execution, humanTaskType, businessKey);

        taskDistributionService.createTask(
                humanTaskType, "ticket", businessKey, payload, TriggerType.EVENT);

        execution.setVariable("pendingTaskType", humanTaskType);

        // 触发可选的 startCallback（通知业务模块人工任务已创建，如设置"进行中"状态）
        String startCallback = AgentTaskDelegate.getFieldValueOrDefault(execution, "startCallback", null);
        if (startCallback != null) {
            try {
                callbackRegistry.executeCallback(startCallback, businessKey, Map.of());
            } catch (Exception e) {
                log.warn("[HumanTaskDelegate] startCallback '{}' failed for businessKey={}: {}",
                        startCallback, businessKey, e.getMessage());
            }
        }
    }

    /**
     * 构建人工任务 payload（包含前端消费者所需的工单信息）
     */
    private String buildPayload(DelegateExecution execution, String humanTaskType, String businessKey) {
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("processInstanceId", execution.getProcessInstanceId());
            payload.put("waitActivityId", execution.getCurrentActivityId() + "_wait");
            payload.put("humanTaskType", humanTaskType);
            payload.put("businessKey", businessKey);

            // 前端消费者所需的工单信息（避免 "Unknown Subject"）
            Long ticketId = parseLongOrNull(businessKey);
            payload.put("ticketId", ticketId);
            payload.put("externalId", businessKey);
            Map<String, Object> ticketData = callbackRegistry.getBusinessData("ticket", businessKey);
            if (ticketData.containsKey("subject")) {
                payload.put("subject", ticketData.get("subject"));
            }
            if (ticketData.containsKey("externalId")) {
                payload.put("externalId", ticketData.get("externalId"));
            }

            return objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            log.warn("[HumanTaskDelegate] Failed to build JSON payload, falling back to simple format", e);
            return String.format(
                    "{\"processInstanceId\":\"%s\",\"waitActivityId\":\"%s\",\"humanTaskType\":\"%s\",\"businessKey\":\"%s\"}",
                    execution.getProcessInstanceId(),
                    execution.getCurrentActivityId() + "_wait",
                    humanTaskType,
                    businessKey
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
