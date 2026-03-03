package com.jefflower.fdserver.ai.dto;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentInstance;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Capability 路由结果 DTO。
 * 包含路由选定的 Agent 定义、实例、客户端等信息。
 */
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class CapabilityRouteResult {

    /** 匹配到的 Agent code */
    private String agentCode;

    /** 路由到的客户端 ID */
    private String clientId;

    /** 路由到的用户 ID */
    private String userId;

    /** Agent 所需的底层执行能力编码 */
    private String requiredCapability;

    /** 匹配到的 Agent 定义 */
    private AgentDefinition agentDefinition;

    /** 匹配到的在线 Agent 实例 */
    private AgentInstance agentInstance;
}
