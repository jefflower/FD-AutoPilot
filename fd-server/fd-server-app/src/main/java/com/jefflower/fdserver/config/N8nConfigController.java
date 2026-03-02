package com.jefflower.fdserver.config;

import com.jefflower.fdserver.common.dto.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@Tag(name = "n8n 配置", description = "n8n 工作流引擎信息")
@RestController
@RequestMapping("/api/v1/config/n8n")
public class N8nConfigController {

    @Value("${n8n.enabled:false}")
    private boolean enabled;

    @Value("${n8n.external-url:http://localhost:5678}")
    private String externalUrl;

    @Operation(summary = "获取 n8n 配置", description = "返回 n8n 是否启用及访问地址")
    @GetMapping
    public ResponseEntity<ApiResponse<Map<String, Object>>> getN8nConfig() {
        return ResponseEntity.ok(ApiResponse.ok(Map.of(
                "enabled", enabled,
                "url", externalUrl
        )));
    }
}
