package com.jefflower.fdserver.workflow.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiConsumer;

import static org.junit.jupiter.api.Assertions.*;

@ExtendWith(MockitoExtension.class)
class WorkflowCallbackRegistryTest {

    private WorkflowCallbackRegistry registry;

    @BeforeEach
    void setUp() {
        registry = new WorkflowCallbackRegistry();
    }

    // ========== register ==========

    @Test
    void register_storesCallback() {
        // given
        BiConsumer<String, Map<String, Object>> callback = (bk, vars) -> {};

        // when
        registry.register("ticket.translationDone", callback);

        // then
        assertTrue(registry.hasCallback("ticket.translationDone"));
    }

    @Test
    void register_overwritesPreviousCallback() {
        // given
        AtomicBoolean firstCalled = new AtomicBoolean(false);
        AtomicBoolean secondCalled = new AtomicBoolean(false);
        BiConsumer<String, Map<String, Object>> first = (bk, vars) -> firstCalled.set(true);
        BiConsumer<String, Map<String, Object>> second = (bk, vars) -> secondCalled.set(true);

        // when — 同一 callbackType 注册两次，第二次覆盖第一次
        registry.register("ticket.testEvent", first);
        registry.register("ticket.testEvent", second);
        registry.executeCallback("ticket.testEvent", "bk-1", Map.of());

        // then — 只有第二个回调被调用
        assertFalse(firstCalled.get());
        assertTrue(secondCalled.get());
    }

    // ========== hasCallback ==========

    @Test
    void hasCallback_returnsTrueWhenRegistered() {
        // given
        registry.register("ticket.replyDone", (bk, vars) -> {});

        // when / then
        assertTrue(registry.hasCallback("ticket.replyDone"));
    }

    @Test
    void hasCallback_returnsFalseWhenNotRegistered() {
        // when / then — 未注册的类型应返回 false
        assertFalse(registry.hasCallback("ticket.nonExistent"));
    }

    // ========== executeCallback ==========

    @Test
    void executeCallback_invokesRegisteredCallback() {
        // given
        AtomicReference<String> capturedBusinessKey = new AtomicReference<>();
        AtomicReference<Map<String, Object>> capturedVars = new AtomicReference<>();

        registry.register("ticket.auditDone", (bk, vars) -> {
            capturedBusinessKey.set(bk);
            capturedVars.set(vars);
        });

        Map<String, Object> vars = new HashMap<>();
        vars.put("result", "PASS");

        // when
        registry.executeCallback("ticket.auditDone", "ticket-42", vars);

        // then
        assertEquals("ticket-42", capturedBusinessKey.get());
        assertEquals("PASS", capturedVars.get().get("result"));
    }

    @Test
    void executeCallback_logsWarningWhenNotRegistered() {
        // given — 未注册任何回调

        // when / then — 不应抛出异常，仅记录 warn 日志
        assertDoesNotThrow(() ->
                registry.executeCallback("ticket.noCallback", "bk-99", Map.of())
        );
    }

    @Test
    void executeCallback_wrapsExceptionInRuntimeException() {
        // given — 回调内部抛出异常
        registry.register("ticket.failingCallback", (bk, vars) -> {
            throw new IllegalStateException("callback logic failed");
        });

        // when / then — 应被包装为 RuntimeException
        RuntimeException ex = assertThrows(RuntimeException.class, () ->
                registry.executeCallback("ticket.failingCallback", "bk-1", Map.of())
        );

        assertTrue(ex.getMessage().contains("ticket.failingCallback"));
        assertInstanceOf(IllegalStateException.class, ex.getCause());
        assertEquals("callback logic failed", ex.getCause().getMessage());
    }

    @Test
    void executeCallback_passesNullVarsToCallback() {
        // given — 回调接受 null vars
        AtomicBoolean called = new AtomicBoolean(false);
        registry.register("ticket.nullVars", (bk, vars) -> {
            called.set(true);
            // vars 可以是 null，回调自行处理
        });

        // when
        registry.executeCallback("ticket.nullVars", "bk-1", null);

        // then
        assertTrue(called.get());
    }
}
