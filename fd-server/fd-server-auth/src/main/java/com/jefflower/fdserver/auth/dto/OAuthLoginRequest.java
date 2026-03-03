package com.jefflower.fdserver.auth.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class OAuthLoginRequest {
    @NotBlank(message = "authCode 不能为空")
    private String authCode;
}
