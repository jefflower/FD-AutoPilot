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
}
