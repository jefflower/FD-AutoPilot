package com.jefflower.fdserver.auth.config;

import com.jefflower.fdserver.auth.security.JwtAuthenticationFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final Environment environment;

    @Value("${cors.allowed-origins:}")
    private String configuredOrigins;

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /**
     * H2 Console 专用安全链：仅在 dev profile 且 H2 Console 启用时生效。
     * 禁用 frameOptions 以支持 iframe 嵌入。
     */
    @Bean
    @Order(0)
    public SecurityFilterChain h2ConsoleFilterChain(HttpSecurity http) throws Exception {
        boolean isDevProfile = Arrays.asList(environment.getActiveProfiles()).contains("dev");

        if (isDevProfile) {
            http
                    .securityMatcher("/h2-console/**")
                    .csrf(csrf -> csrf.disable())
                    .headers(headers -> headers.frameOptions(frame -> frame.disable()))
                    .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        } else {
            // 非 dev 环境：拒绝所有对 H2 Console 的访问
            http
                    .securityMatcher("/h2-console/**")
                    .authorizeHttpRequests(auth -> auth.anyRequest().denyAll());
        }
        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();

        // Tauri 桌面客户端始终允许
        List<String> tauriOrigins = List.of("tauri://localhost", "https://tauri.localhost");

        if (configuredOrigins != null && !configuredOrigins.isBlank()) {
            // 生产环境：使用精确匹配（cors.allowed-origins 配置值 + Tauri）
            List<String> origins = new ArrayList<>(Arrays.asList(configuredOrigins.split(",")));
            origins.addAll(tauriOrigins);
            configuration.setAllowedOrigins(origins);
        } else {
            // 开发环境：宽松模式（localhost 通配 + Tauri）
            List<String> patterns = new ArrayList<>(Arrays.asList("http://localhost:*", "http://127.0.0.1:*"));
            patterns.addAll(tauriOrigins);
            configuration.setAllowedOriginPatterns(patterns);
        }

        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // 静态资源：前端 SPA（index.html、JS/CSS/图片等）
                        .requestMatchers("/", "/index.html", "/vite.svg", "/assets/**", "/favicon.ico").permitAll()
                        // SpringDoc OpenAPI / Swagger UI
                        .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/api-docs/**", "/v3/api-docs/**").permitAll()
                        // auth/me/** 需要认证（modules、permissions 端点需要有效 token）
                        .requestMatchers("/api/v1/auth/me/**").authenticated()
                        // 白名单：仅 login、register、refresh-token、OAuth 不需要认证
                        .requestMatchers("/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/refresh-token").permitAll()
                        .requestMatchers("/api/v1/auth/oauth/status", "/api/v1/auth/oauth/*/url", "/api/v1/auth/oauth/*/callback").permitAll()
                        // Webhook（Freshdesk 回调，无需 token）
                        .requestMatchers("/api/v1/webhook/**").permitAll()
                        // 移动审核 Token API（无需 JWT，Token 自身即认证凭证）
                        .requestMatchers("/api/v1/audit-token/**").permitAll()
                        // Actuator: health 端点公开（供 Docker HEALTHCHECK / LB 探针使用），其余需认证
                        .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                        .requestMatchers("/actuator/**").authenticated()
                        .requestMatchers("/api/v1/admin/**").authenticated()
                        .requestMatchers("/api/v1/sync/**").authenticated()
                        // API 需认证，非 API 请求（SPA 前端路由）放行给 SpaWebConfig 处理
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().permitAll())
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
                // H2 控制台需要禁用 frameOptions（dev 环境已在 h2ConsoleFilterChain 中处理）
                .headers(headers -> headers.frameOptions(frame -> frame.sameOrigin()));

        return http.build();
    }
}
