package com.jefflower.fdserver.auth.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OrgSyncResult {
    private int departmentsCreated;
    private int departmentsUpdated;
    private int usersCreated;
    private int usersUpdated;
    private int usersSkipped;
    private String platform;
    private long durationMs;
}
