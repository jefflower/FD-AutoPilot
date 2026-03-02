package com.jefflower.fdserver.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "创建自定义权限请求")
public class PermissionCreateRequest {

    @Schema(description = "权限代码（唯一标识）", example = "custom:view")
    private String code;

    @Schema(description = "权限名称", example = "查看自定义模块")
    private String name;

    @Schema(description = "所属模块代码", example = "custom")
    private String module;

    @Schema(description = "权限描述", example = "允许查看自定义模块的内容")
    private String description;

    @Schema(description = "权限类型: ROUTE(路由/页面访问权限), OPERATION(操作权限), DATA(数据权限)", example = "ROUTE")
    private String type;
}
