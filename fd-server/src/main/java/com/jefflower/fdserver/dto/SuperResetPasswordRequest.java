package com.jefflower.fdserver.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class SuperResetPasswordRequest {
    @NotBlank(message = "用户名不能为空")
    private String username;

    @NotBlank(message = "新密码不能为空")
    private String newPassword;

    @NotBlank(message = "超级密码不能为空")
    private String superPassword;
}
