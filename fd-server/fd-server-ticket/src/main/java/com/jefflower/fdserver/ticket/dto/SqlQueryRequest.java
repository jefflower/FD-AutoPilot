package com.jefflower.fdserver.ticket.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Schema(description = "SQL 查询请求")
@Data
public class SqlQueryRequest {
    @Schema(description = "SQL 查询语句（仅允许 SELECT）", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "SQL 不能为空")
    @Size(max = 10000, message = "SQL 长度不能超过 10000 字符")
    private String sql;

    @Schema(description = "最大返回行数（默认 500）")
    private Integer maxRows;
}
