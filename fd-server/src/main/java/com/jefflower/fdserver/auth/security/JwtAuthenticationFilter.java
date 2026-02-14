package com.jefflower.fdserver.auth.security;

import com.jefflower.fdserver.auth.service.PermissionCacheService;
import com.jefflower.fdserver.auth.service.TokenBlacklistService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;
    private final TokenBlacklistService tokenBlacklistService;
    private final PermissionCacheService permissionCacheService;

    public JwtAuthenticationFilter(JwtUtil jwtUtil,
                                   TokenBlacklistService tokenBlacklistService,
                                   PermissionCacheService permissionCacheService) {
        this.jwtUtil = jwtUtil;
        this.tokenBlacklistService = tokenBlacklistService;
        this.permissionCacheService = permissionCacheService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        try {
            String authHeader = request.getHeader("Authorization");

            if (authHeader != null && authHeader.startsWith("Bearer ")) {
                String token = authHeader.substring(7);

                if (jwtUtil.validateToken(token)) {
                    // 检查 token 是否已被撤销（黑名单检查）
                    String jti = jwtUtil.getJti(token);
                    if (jti != null && tokenBlacklistService.isBlacklisted(jti)) {
                        // Token 已被撤销，跳过认证
                        filterChain.doFilter(request, response);
                        return;
                    }

                    String username = jwtUtil.getUsername(token);
                    Long userId = jwtUtil.getUserId(token);

                    // 提取多角色，生成角色 GrantedAuthority（ROLE_ 前缀）
                    List<String> roles = jwtUtil.getRoles(token);
                    List<GrantedAuthority> authorities = new ArrayList<>();
                    for (String role : roles) {
                        authorities.add(new SimpleGrantedAuthority("ROLE_" + role));
                    }

                    // 从缓存加载用户权限，生成权限 GrantedAuthority（PERM_ 前缀）
                    Set<String> permissions = permissionCacheService.getUserPermissions(userId);
                    for (String perm : permissions) {
                        authorities.add(new SimpleGrantedAuthority("PERM_" + perm));
                    }

                    UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                            username,
                            null, authorities);
                    authentication.setDetails(userId);

                    SecurityContextHolder.getContext().setAuthentication(authentication);
                }
            }
        } catch (Exception e) {
            logger.error("Cannot set user authentication: {}", e);
        }

        filterChain.doFilter(request, response);
    }
}
