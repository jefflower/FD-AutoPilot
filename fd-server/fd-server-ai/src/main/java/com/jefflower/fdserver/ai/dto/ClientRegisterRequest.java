package com.jefflower.fdserver.ai.dto;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

@Getter @Setter @NoArgsConstructor
public class ClientRegisterRequest {

    private String clientId;
    private String clientType;  // TAURI / WEB / BRIDGE
    private String version;
    private List<String> enabledCapabilities;
    private List<String> runningAgents;
}
