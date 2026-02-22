package com.jefflower.fdserver.workflow.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiConsumer;

/**
 * 工作流回调注册中心。
 * <p>
 * ticket 模块在启动时注册回调（如 "ticket.translationDone"），
 * BusinessCallbackDelegate 执行时通过此注册中心查找并调用。
 * 这样 workflow 模块不直接依赖 ticket 模块。
 */
@Service
public class WorkflowCallbackRegistry {

    private static final Logger log = LoggerFactory.getLogger(WorkflowCallbackRegistry.class);

    private final Map<String, BiConsumer<String, Map<String, Object>>> callbacks = new ConcurrentHashMap<>();

    /**
     * 注册回调
     *
     * @param callbackType 回调类型（如 "ticket.translationDone"）
     * @param callback     回调函数，参数: (businessKey, variables)
     */
    public void register(String callbackType, BiConsumer<String, Map<String, Object>> callback) {
        callbacks.put(callbackType, callback);
        log.info("[WorkflowCallbackRegistry] Registered callback: {}", callbackType);
    }

    /**
     * 执行回调
     */
    public void executeCallback(String callbackType, String businessKey, Map<String, Object> vars) {
        BiConsumer<String, Map<String, Object>> callback = callbacks.get(callbackType);
        if (callback == null) {
            log.warn("[WorkflowCallbackRegistry] No callback registered for type: {}", callbackType);
            return;
        }
        try {
            callback.accept(businessKey, vars);
            log.info("[WorkflowCallbackRegistry] Callback {} executed for businessKey={}", callbackType, businessKey);
        } catch (Exception e) {
            log.error("[WorkflowCallbackRegistry] Callback {} failed for businessKey={}", callbackType, businessKey, e);
            throw new RuntimeException("Workflow callback failed: " + callbackType, e);
        }
    }

    /**
     * 检查回调是否已注册
     */
    public boolean hasCallback(String callbackType) {
        return callbacks.containsKey(callbackType);
    }
}
