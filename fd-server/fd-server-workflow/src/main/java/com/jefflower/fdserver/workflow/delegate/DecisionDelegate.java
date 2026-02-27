package com.jefflower.fdserver.workflow.delegate;

import com.jefflower.fdserver.workflow.service.WorkflowCallbackRegistry;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * BPMN ServiceTask 桥接 — 业务决策。
 * <p>
 * 从 BPMN FieldExtension 读取 decisionType，通过 WorkflowCallbackRegistry
 * 获取业务数据，判断是否跳过后续 Agent 执行。
 * <p>
 * 决策类型：
 * <ul>
 *   <li>shouldSkipTranslation — 检查工单是否已有完整翻译</li>
 *   <li>shouldSkipReply — 检查最后对话是否来自客户</li>
 * </ul>
 * <p>
 * 结果写入 execution-local 变量 {@code skipAgent}（避免并行分支变量冲突）。
 */
@Component("decisionDelegate")
public class DecisionDelegate implements JavaDelegate {

    private static final Logger log = LoggerFactory.getLogger(DecisionDelegate.class);

    private static final String DECISION_DATA_PROVIDER = "ticket.decision";

    private final WorkflowCallbackRegistry callbackRegistry;

    public DecisionDelegate(WorkflowCallbackRegistry callbackRegistry) {
        this.callbackRegistry = callbackRegistry;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String decisionType = AgentTaskDelegate.getFieldValue(execution, "decisionType");
        String businessKey = execution.getProcessInstanceBusinessKey();

        log.info("[DecisionDelegate] Evaluating decision={}, businessKey={}, activityId={}",
                decisionType, businessKey, execution.getCurrentActivityId());

        boolean skip = false;
        switch (decisionType) {
            case "shouldSkipTranslation":
                skip = checkShouldSkipTranslation(businessKey);
                break;
            case "shouldSkipReply":
                skip = checkShouldSkipReply(businessKey);
                break;
            default:
                log.warn("[DecisionDelegate] Unknown decisionType: {}", decisionType);
        }

        execution.setVariableLocal("skipAgent", skip);
        log.info("[DecisionDelegate] Decision={}, businessKey={}, skipAgent={}",
                decisionType, businessKey, skip);
    }

    /**
     * 检查工单是否已有完整翻译。
     * 通过 ticket.decision 数据提供者获取 hasTranslation 标志。
     */
    private boolean checkShouldSkipTranslation(String businessKey) {
        Map<String, Object> data = callbackRegistry.getBusinessData(DECISION_DATA_PROVIDER, businessKey);
        if (data.isEmpty()) {
            log.warn("[DecisionDelegate] No decision data for businessKey={}, not skipping translation", businessKey);
            return false;
        }
        Object hasTranslation = data.get("hasTranslation");
        return Boolean.TRUE.equals(hasTranslation);
    }

    /**
     * 检查最后对话是否来自客户（不跳过回复）或客服/Agent（跳过回复）。
     * 通过 ticket.decision 数据提供者获取 isLastMessageFromCustomer 标志。
     */
    private boolean checkShouldSkipReply(String businessKey) {
        Map<String, Object> data = callbackRegistry.getBusinessData(DECISION_DATA_PROVIDER, businessKey);
        if (data.isEmpty()) {
            log.warn("[DecisionDelegate] No decision data for businessKey={}, not skipping reply", businessKey);
            return false;
        }
        Object isLastMessageFromCustomer = data.get("isLastMessageFromCustomer");
        // 如果最后消息来自客户 → 不跳过（skip=false）
        // 如果最后消息不是来自客户 → 跳过（skip=true）
        return Boolean.FALSE.equals(isLastMessageFromCustomer);
    }
}
