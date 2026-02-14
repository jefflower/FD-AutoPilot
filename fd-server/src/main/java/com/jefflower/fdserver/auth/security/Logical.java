package com.jefflower.fdserver.auth.security;

/**
 * 多权限之间的逻辑关系。
 * <ul>
 *   <li>{@link #AND} — 需要同时满足全部指定权限</li>
 *   <li>{@link #OR} — 满足其中任一权限即可</li>
 * </ul>
 */
public enum Logical {
    AND,
    OR
}
