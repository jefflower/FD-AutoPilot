package com.jefflower.fdserver.dto;

import lombok.Data;

@Data
public class ApproveRequest {
    private String action; // APPROVE or REJECT
}
