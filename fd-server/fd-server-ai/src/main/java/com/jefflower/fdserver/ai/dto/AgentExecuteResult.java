package com.jefflower.fdserver.ai.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class AgentExecuteResult {
    private boolean success;
    private String output;
    private Integer tokenCount;
    private String errorMessage;
}
