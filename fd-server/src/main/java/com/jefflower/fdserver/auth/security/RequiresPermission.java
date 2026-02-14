package com.jefflower.fdserver.auth.security;

import java.lang.annotation.*;

/**
 * 方法级/类级权限控制注解。
 * <p>
 * 被标注的方法在执行前，会由 {@link PermissionAspect} 检查当前用户是否拥有指定权限。
 * <p>
 * 使用示例:
 * <pre>
 * // 需要同时拥有 ticket:read 和 ticket:write 权限
 * &#64;RequiresPermission({"ticket:read", "ticket:write"})
 *
 * // 拥有其中任一权限即可
 * &#64;RequiresPermission(value = {"ticket:read", "ticket:export"}, logical = Logical.OR)
 * </pre>
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface RequiresPermission {

    /**
     * 需要的权限代码，如 "ticket:read", "user:manage"
     */
    String[] value();

    /**
     * 多权限之间的逻辑关系，默认 AND（需要全部满足）
     */
    Logical logical() default Logical.AND;
}
