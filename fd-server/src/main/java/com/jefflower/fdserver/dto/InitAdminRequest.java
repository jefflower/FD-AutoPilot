package com.jefflower.fdserver.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class InitAdminRequest {
    @NotBlank(message = "密码不能为空")
    private String password;

    @NotBlank(message = "超级密码不能为空")
    private String superPassword;
}
