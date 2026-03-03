package com.jefflower.fdserver.ai.dto;

import lombok.Data;

@Data
public class AgentExecuteRequest {
    private String input;
    private String referenceType;
    private Long referenceId;
}
