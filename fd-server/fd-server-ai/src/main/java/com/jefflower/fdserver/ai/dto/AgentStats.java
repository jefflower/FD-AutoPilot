package com.jefflower.fdserver.ai.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class AgentStats {
    private String agentCode;
    private String agentName;
    private long totalExecutions;
    private long successCount;
    private long failedCount;
    private double avgDurationMs;
    private double successRate;
}
