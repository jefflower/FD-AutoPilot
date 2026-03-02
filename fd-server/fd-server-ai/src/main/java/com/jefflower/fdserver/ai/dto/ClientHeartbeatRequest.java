package com.jefflower.fdserver.ai.dto;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

@Getter @Setter @NoArgsConstructor
public class ClientHeartbeatRequest {

    private String clientId;
    private List<String> runningAgents;
}
