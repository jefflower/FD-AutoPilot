package com.jefflower.fdserver.common.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnResource;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

import java.io.IOException;

/**
 * SPA 路由支持：非 API 路径转发到 index.html。
 * 仅在 static/index.html 存在时激活（即包含前端构建产物时）。
 */
@Configuration
@ConditionalOnResource(resources = "classpath:static/index.html")
public class SpaWebConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location) throws IOException {
                        Resource requested = location.createRelative(resourcePath);
                        // 如果请求的是真实文件（JS/CSS/图片），返回文件
                        // 否则返回 index.html（SPA 前端路由）
                        if (requested.exists() && requested.isReadable()) {
                            return requested;
                        }
                        // 排除 API、H2 Console、n8n 反向代理等路径
                        if (resourcePath.startsWith("api/") || resourcePath.startsWith("h2-console")
                                || resourcePath.startsWith("actuator/")
                                || resourcePath.startsWith("v3/")
                                || resourcePath.startsWith("swagger-ui")
                                || resourcePath.startsWith("n8n/") || resourcePath.equals("n8n")) {
                            return null;
                        }
                        return new ClassPathResource("/static/index.html");
                    }
                });
    }
}
