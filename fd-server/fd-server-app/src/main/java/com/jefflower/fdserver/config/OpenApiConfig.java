package com.jefflower.fdserver.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    private static final String SECURITY_SCHEME_NAME = "Bearer JWT";

    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("FD-AutoPilot API")
                        .version("1.0.0")
                        .description("FD-AutoPilot 智能工单处理系统 API 文档。集成 Freshdesk 与 AI 能力，提供工单生命周期管理、自动翻译、AI 回复生成、审核流转等功能。")
                        .contact(new Contact()
                                .name("FD-AutoPilot Team")))
                .addSecurityItem(new SecurityRequirement().addList(SECURITY_SCHEME_NAME))
                .components(new Components()
                        .addSecuritySchemes(SECURITY_SCHEME_NAME,
                                new SecurityScheme()
                                        .name(SECURITY_SCHEME_NAME)
                                        .type(SecurityScheme.Type.HTTP)
                                        .scheme("bearer")
                                        .bearerFormat("JWT")
                                        .description("JWT 认证令牌。通过 /api/v1/auth/login 获取，格式：Bearer {token}")));
    }

    @Bean
    public GroupedOpenApi authGroup() {
        return GroupedOpenApi.builder()
                .group("1-auth")
                .displayName("认证授权")
                .pathsToMatch("/api/v1/auth/**", "/api/v1/user/settings/**")
                .build();
    }

    @Bean
    public GroupedOpenApi ticketGroup() {
        return GroupedOpenApi.builder()
                .group("2-ticket")
                .displayName("工单管理")
                .pathsToMatch("/api/v1/tickets/**", "/api/v1/webhook/**")
                .build();
    }

    @Bean
    public GroupedOpenApi taskGroup() {
        return GroupedOpenApi.builder()
                .group("3-task")
                .displayName("任务调度")
                .pathsToMatch("/api/v1/tasks/**", "/api/v1/task-admin/**")
                .build();
    }

    @Bean
    public GroupedOpenApi systemGroup() {
        return GroupedOpenApi.builder()
                .group("4-system")
                .displayName("系统管理")
                .pathsToMatch("/api/v1/sync/**", "/api/v1/config/**",
                        "/api/v1/admin/knowledge/**", "/api/v1/admin/database/**",
                        "/api/requests/**")
                .build();
    }
}
