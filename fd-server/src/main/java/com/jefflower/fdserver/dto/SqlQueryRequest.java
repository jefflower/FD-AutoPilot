package com.jefflower.fdserver.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class SqlQueryRequest {
    @NotBlank(message = "SQL 不能为空")
    @Size(max = 10000, message = "SQL 长度不能超过 10000 字符")
    private String sql;

    private Integer maxRows;
}
