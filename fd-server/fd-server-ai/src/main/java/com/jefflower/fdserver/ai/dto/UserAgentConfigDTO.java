package com.jefflower.fdserver.ai.dto;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter @Setter @NoArgsConstructor
public class UserAgentConfigDTO {
    private String agentCode;
    private boolean autoStart;
    private boolean enabled;
    private LocalDateTime subscribedAt;
    // 来自 AgentDefinition 的摘要
    private String agentName;
    private String description;
    private String capability;
    private String requiredCapability;
    private String executionEnv;
    private String groupCode;
    private boolean agentEnabled;  // AgentDefinition 全局启用状态
    /** Agent 定义的用户可配置参数 Schema（JSON） */
    private String userConfigSchema;
    /** 用户已配置的自定义参数（JSON） */
    private String customConfig;
}
