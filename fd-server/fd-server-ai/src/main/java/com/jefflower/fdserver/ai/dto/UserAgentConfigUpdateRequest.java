package com.jefflower.fdserver.ai.dto;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter @Setter @NoArgsConstructor
public class UserAgentConfigUpdateRequest {
    private Boolean autoStart;
    private Boolean enabled;
    /** 用户自定义参数配置（JSON）*/
    private String customConfig;
}
