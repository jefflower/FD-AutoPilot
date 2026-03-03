package com.jefflower.fdserver.ai.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class AgentProxyTestResult {
    private boolean reachable;
    private List<String> models;
    private String errorMessage;
}
