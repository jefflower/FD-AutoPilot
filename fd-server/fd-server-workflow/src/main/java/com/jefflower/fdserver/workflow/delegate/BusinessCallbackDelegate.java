package com.jefflower.fdserver.workflow.delegate;

import com.jefflower.fdserver.workflow.service.WorkflowCallbackRegistry;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * BPMN ServiceTask 桥接 — 业务回调。
 * <p>
 * 从 BPMN FieldExtension 读取 callbackType（如 "ticket.translationDone"），
 * 通过 WorkflowCallbackRegistry 查找并执行 ticket 模块注册的回调。
 */
@Component("businessCallbackDelegate")
public class BusinessCallbackDelegate implements JavaDelegate {

    private static final Logger log = LoggerFactory.getLogger(BusinessCallbackDelegate.class);

    private final WorkflowCallbackRegistry callbackRegistry;

    public BusinessCallbackDelegate(WorkflowCallbackRegistry callbackRegistry) {
        this.callbackRegistry = callbackRegistry;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String callbackType = AgentTaskDelegate.getFieldValue(execution, "callbackType");
        String businessKey = execution.getProcessInstanceBusinessKey();

        log.info("[BusinessCallbackDelegate] Executing callback={}, businessKey={}", callbackType, businessKey);

        Map<String, Object> vars = new HashMap<>(execution.getVariables());
        callbackRegistry.executeCallback(callbackType, businessKey, vars);
    }
}
