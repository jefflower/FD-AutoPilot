import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';

interface AuthGuardProps {
  children: ReactNode;
  isAuthenticated: boolean;
}

export function AuthGuard({ children, isAuthenticated }: AuthGuardProps) {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

interface PermissionGuardProps {
  children: ReactNode;
  requiredPermission?: string;
  userPermissions: string[];
}

export function PermissionGuard({ children, requiredPermission, userPermissions }: PermissionGuardProps) {
  if (requiredPermission && !userPermissions.includes(requiredPermission)) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>无权限访问此页面</p>
      </div>
    );
  }
  return <>{children}</>;
}
