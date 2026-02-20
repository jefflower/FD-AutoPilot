package com.jefflower.fdserver.auth.dto;

import lombok.Data;

@Data
public class ApproveRequest {
    private String action; // APPROVE or REJECT
}
