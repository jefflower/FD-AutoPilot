package com.jefflower.fdserver.ai.dto;

import lombok.Data;

@Data
public class AgentExecutionReport {
    private String agentCode;
    private String status;
    private Long durationMs;
    private Integer tokenCount;
    private String referenceType;
    private Long referenceId;
    private String executedOn;
    private String inputSnapshot;
    private String outputSnapshot;
    private String errorMessage;
}
