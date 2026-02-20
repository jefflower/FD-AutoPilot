/**
 * 权限守卫组件
 *
 * 注意：当前应用使用 Tab-based 路由模式（非 React Router），
 * 这些守卫组件被设计为通用 React 组件，通过 AuthContext 获取状态。
 * 如未来迁移到 React Router，可直接在 Route 组件中使用。
 */

import type { ReactNode } from 'react';
import { useAuthContext } from '../shared/context/AuthContext';

interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * 认证守卫 — 未登录时渲染 fallback（默认返回 null）
 */
export function AuthGuard({ children, fallback = null }: AuthGuardProps) {
  const { isLoggedIn } = useAuthContext();
  if (!isLoggedIn) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}

interface PermissionGuardProps {
  children: ReactNode;
  requiredPermission?: string;
}

/**
 * 权限守卫 — 基于 useAuthContext 的 hasPermission 检查
 */
export function PermissionGuard({ children, requiredPermission }: PermissionGuardProps) {
  const { hasPermission } = useAuthContext();
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>无权限访问此页面</p>
      </div>
    );
  }
  return <>{children}</>;
}
