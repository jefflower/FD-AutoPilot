package com.jefflower.fdserver.ai.dto;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.Map;

/**
 * Capability 级执行响应 DTO。
 */
@Getter
@Setter
@NoArgsConstructor
public class CapabilityExecuteResponse {

    /** Agent 执行结果 */
    private AgentExecuteResult result;

    /** 路由信息（调试用） */
    private Map<String, String> routeInfo;
}
