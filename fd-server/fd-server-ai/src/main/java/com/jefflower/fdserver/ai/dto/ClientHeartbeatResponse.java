package com.jefflower.fdserver.ai.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.List;

@Getter @Setter @NoArgsConstructor @AllArgsConstructor
public class ClientHeartbeatResponse {

    private LocalDateTime serverTime;
    private List<Object> commands;  // reserved for future use
    private int registeredAgents;   // 该客户端关联的 Agent 数量
    private int onlineClients;      // 当前在线客户端总数

    /**
     * 兼容旧的两参数构造（保持向前兼容）。
     */
    public ClientHeartbeatResponse(LocalDateTime serverTime, List<Object> commands) {
        this.serverTime = serverTime;
        this.commands = commands;
    }
}
