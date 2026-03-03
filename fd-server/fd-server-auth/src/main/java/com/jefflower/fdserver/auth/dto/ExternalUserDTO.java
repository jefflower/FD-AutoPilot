package com.jefflower.fdserver.auth.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ExternalUserDTO {
    private String externalUserId;
    private String name;
    private String mobile;
    private String email;
    private String avatar;
    private String departmentExternalId;
    private boolean active;
}
