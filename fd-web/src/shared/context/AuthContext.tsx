/**
 * AuthContext — 认证状态的全局 Context Provider
 *
 * 将 useAuth hook 提升为 Context，解决 prop drilling 问题。
 * 所有子组件通过 useAuthContext() 获取共享的认证状态，
 * 而非通过 props 层层传递 isLoggedIn / isAdmin / user 等。
 */

import React, { createContext, useContext } from 'react';
import { useAuth } from '../hooks/useAuth';

/** useAuth 的返回类型 */
type AuthContextType = ReturnType<typeof useAuth>;

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * AuthProvider — 包裹在应用顶层，提供认证状态
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const auth = useAuth();
    return (
        <AuthContext.Provider value={auth}>
            {children}
        </AuthContext.Provider>
    );
};

/**
 * useAuthContext — 在子组件中获取认证状态
 * 替代 prop drilling 中的 isLoggedIn / isAdmin / user / login / logout 等 props
 */
export function useAuthContext(): AuthContextType {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuthContext must be used within an AuthProvider');
    }
    return ctx;
}
