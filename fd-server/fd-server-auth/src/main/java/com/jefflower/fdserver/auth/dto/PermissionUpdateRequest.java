package com.jefflower.fdserver.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "更新权限请求（内置权限仅支持编辑 name 和 description）")
public class PermissionUpdateRequest {

    @Schema(description = "权限名称", example = "查看自定义模块")
    private String name;

    @Schema(description = "权限描述", example = "允许查看自定义模块的内容")
    private String description;

    @Schema(description = "权限类型: ROUTE(路由/页面访问权限), OPERATION(操作权限), DATA(数据权限)，内置权限不可更改", example = "ROUTE")
    private String type;
}
