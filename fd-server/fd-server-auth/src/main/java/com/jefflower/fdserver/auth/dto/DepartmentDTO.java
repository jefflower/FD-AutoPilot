package com.jefflower.fdserver.auth.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DepartmentDTO {
    private String externalId;
    private String name;
    private String parentExternalId;
    private Integer sortOrder;
}
