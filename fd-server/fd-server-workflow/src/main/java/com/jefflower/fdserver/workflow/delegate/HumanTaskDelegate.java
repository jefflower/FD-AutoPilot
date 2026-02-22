package com.jefflower.fdserver.workflow.delegate;

import com.jefflower.fdserver.task.enums.TriggerType;
import com.jefflower.fdserver.task.service.TaskDistributionService;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

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

    public HumanTaskDelegate(TaskDistributionService taskDistributionService) {
        this.taskDistributionService = taskDistributionService;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String humanTaskType = AgentTaskDelegate.getFieldValue(execution, "humanTaskType");
        String businessKey = execution.getProcessInstanceBusinessKey();

        log.info("[HumanTaskDelegate] Creating human task type={}, businessKey={}", humanTaskType, businessKey);

        String payload = String.format(
                "{\"processInstanceId\":\"%s\",\"waitActivityId\":\"%s\",\"humanTaskType\":\"%s\",\"businessKey\":\"%s\"}",
                execution.getProcessInstanceId(),
                execution.getCurrentActivityId() + "_wait",
                humanTaskType,
                businessKey
        );

        taskDistributionService.createTask(
                humanTaskType, "ticket", businessKey, payload, TriggerType.EVENT);

        execution.setVariable("pendingTaskType", humanTaskType);
    }
}
