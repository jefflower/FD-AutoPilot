package com.jefflower.fdserver.auth.security;

import java.lang.annotation.*;

@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface RequiresPermission {
    String[] value();
    Logical logical() default Logical.AND;
}
