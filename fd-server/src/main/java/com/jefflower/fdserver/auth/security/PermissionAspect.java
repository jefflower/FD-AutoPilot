package com.jefflower.fdserver.auth.security;

import com.jefflower.fdserver.auth.service.PermissionCacheService;
import com.jefflower.fdserver.auth.security.Logical;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.core.annotation.Order;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Set;

/**
 * AOP 切面：拦截 {@link RequiresPermission} 注解，执行细粒度权限检查。
 * <p>
 * 处理逻辑：
 * <ol>
 *   <li>从 SecurityContext 获取当前认证信息</li>
 *   <li>SUPER_ADMIN 角色直接放行（拥有全部权限）</li>
 *   <li>从 {@link PermissionCacheService} 获取用户权限集合</li>
 *   <li>根据 {@link Logical} 逻辑关系判断是否满足权限要求</li>
 * </ol>
 */
@Slf4j
@Aspect
@Component
@RequiredArgsConstructor
@Order(1) // 在事务之前执行
public class PermissionAspect {

    private final PermissionCacheService permissionCacheService;

    @Around("@annotation(requiresPermission)")
    public Object checkPermission(ProceedingJoinPoint joinPoint, RequiresPermission requiresPermission) throws Throwable {
        // 1. 从 SecurityContext 获取当前认证信息
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            throw new AccessDeniedException("未认证");
        }

        // 2. 获取 userId（存储在 authentication.details 中）
        Object details = auth.getDetails();
        if (!(details instanceof Long userId)) {
            throw new AccessDeniedException("无法获取用户信息");
        }

        // 3. 检查是否有 SUPER_ADMIN 角色（直接放行，拥有所有权限）
        boolean isSuperAdmin = auth.getAuthorities().stream()
                .anyMatch(a -> "ROLE_SUPER_ADMIN".equals(a.getAuthority()));
        if (isSuperAdmin) {
            log.debug("SUPER_ADMIN 用户 userId={} 直接放行", userId);
            return joinPoint.proceed();
        }

        // 4. 从缓存获取用户权限
        Set<String> userPermissions = permissionCacheService.getUserPermissions(userId);

        // 5. 检查权限
        String[] requiredPerms = requiresPermission.value();
        Logical logical = requiresPermission.logical();

        boolean hasPermission;
        if (logical == Logical.AND) {
            hasPermission = Arrays.stream(requiredPerms).allMatch(userPermissions::contains);
        } else {
            hasPermission = Arrays.stream(requiredPerms).anyMatch(userPermissions::contains);
        }

        if (!hasPermission) {
            log.warn("权限不足: userId={}, required={}, logical={}, owned={}",
                    userId, Arrays.toString(requiredPerms), logical, userPermissions);
            throw new AccessDeniedException("权限不足: " + String.join(", ", requiredPerms));
        }

        log.debug("权限检查通过: userId={}, required={}", userId, Arrays.toString(requiredPerms));
        return joinPoint.proceed();
    }
}
