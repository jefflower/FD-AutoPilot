package com.jefflower.fdserver.task.dto;

import lombok.Data;

@Data
public class TaskCompleteRequest {
    private String clientId;
    private boolean success;
    private String message;
}
