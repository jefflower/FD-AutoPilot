package com.jefflower.fdserver.ai.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter @Setter @NoArgsConstructor @AllArgsConstructor
public class ClientRegisterResponse {

    private String clientId;
    private int instanceCount;
    private int onlineClients;
}
