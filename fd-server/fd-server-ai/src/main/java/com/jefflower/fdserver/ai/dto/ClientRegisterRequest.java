package com.jefflower.fdserver.ai.dto;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;
import java.util.Map;

@Getter @Setter @NoArgsConstructor
public class ClientRegisterRequest {

    private String clientId;
    private String clientType;  // TAURI / WEB / BRIDGE
    private String version;
    private List<String> enabledCapabilities;
    private List<String> runningAgents;

    /** 客户端检测到的 AI Skills，按 capability 分组：{"gemini-cli": [{name, description}], ...} */
    private Map<String, List<SkillItem>> detectedSkills;

    @Getter @Setter @NoArgsConstructor
    public static class SkillItem {
        private String name;
        private String description;
        private String command;
    }
}
