package com.jefflower.fdserver.dto;

import lombok.Data;

import java.util.List;

@Data
public class BatchValidRequest {
    private List<Long> ticketIds;
    private Boolean isValid;
}
