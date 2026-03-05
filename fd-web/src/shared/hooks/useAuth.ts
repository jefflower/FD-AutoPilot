/**
 * 认证状态管理 Hook
 */

import { useState, useEffect, useCallback } from 'react';
import { authApi, oauthApi, getAuthToken, setAuthToken, isTokenExpired, ApiError } from '../services/serverApi';
import { clearDetectionCache } from '../agents/AgentContext';
import type { User, UserRole, LoginRequest, RegisterRequest } from '../types/server';

interface AuthState {
  token: string | null;
  user: User | null;
  isLoggedIn: boolean;
  isAdmin: boolean;        // 保留（ADMIN 或 SUPER_ADMIN）
  roles: string[];          // 新增：完整角色列表
  isLoading: boolean;
  error: string | null;
  errorCode: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    token: getAuthToken(),
    user: null,
    isLoggedIn: false,
    isAdmin: false,
    roles: [],
    isLoading: true,
    error: null,
    errorCode: null,
  });

  // 初始化时检查本地存储的 token（含过期校验）
  useEffect(() => {
    const token = getAuthToken();
    const savedUser = localStorage.getItem('fd_auth_user');

    if (token && savedUser) {
      // token 已过期，清除并跳转到登录
      if (isTokenExpired(token)) {
        console.warn('[useAuth] Stored token is expired, clearing...');
        setAuthToken(null);
        localStorage.removeItem('fd_auth_user');
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      try {
        const user = JSON.parse(savedUser) as User;
        const roles = user.roles || [user.role];
        const isAdmin = roles.some(r => r === 'ADMIN' || r === 'SUPER_ADMIN');
        setState({
          token,
          user,
          isLoggedIn: true,
          isAdmin,
          roles,
          isLoading: false,
          error: null,
          errorCode: null,
        });
      } catch {
        // 解析失败，清除
        setAuthToken(null);
        localStorage.removeItem('fd_auth_user');
        setState(prev => ({ ...prev, isLoading: false }));
      }
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  const login = useCallback(async (credentials: LoginRequest) => {
    setState(prev => ({ ...prev, isLoading: true, error: null, errorCode: null }));

    try {
      const response = await authApi.login(credentials);
      const user = response.user;

      // 检查 user 是否存在
      if (!user) {
        throw new Error('登录响应缺少用户信息');
      }

      localStorage.setItem('fd_auth_user', JSON.stringify(user));

      const roles = user.roles || [user.role];
      const isAdmin = roles.some(r => r === 'ADMIN' || r === 'SUPER_ADMIN');

      setState({
        token: response.accessToken || response.token,
        user,
        isLoggedIn: true,
        isAdmin,
        roles,
        isLoading: false,
        error: null,
        errorCode: null,
      });

      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: err.message,
          errorCode: err.code,
        }));
      } else {
        const message = err instanceof Error ? err.message : '登录失败';
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: message,
          errorCode: null,
        }));
      }
      throw err;
    }
  }, []);

  const register = useCallback(async (data: RegisterRequest) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      await authApi.register(data);
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : '注册失败';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
      throw err;
    }
  }, []);

  const oauthLogin = useCallback(async (platform: string, authCode: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null, errorCode: null }));

    try {
      const response = await oauthApi.oauthCallback(platform, authCode);
      const user = response.user;

      if (!user) {
        throw new Error('OAuth 登录响应缺少用户信息');
      }

      localStorage.setItem('fd_auth_user', JSON.stringify(user));

      const roles = user.roles || [user.role];
      const isAdmin = roles.some(r => r === 'ADMIN' || r === 'SUPER_ADMIN');

      setState({
        token: response.accessToken || response.token,
        user,
        isLoggedIn: true,
        isAdmin,
        roles,
        isLoading: false,
        error: null,
        errorCode: null,
      });

      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: err.message,
          errorCode: err.code,
        }));
      } else {
        const message = err instanceof Error ? err.message : 'OAuth 登录失败';
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: message,
          errorCode: null,
        }));
      }
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    authApi.logout();
    localStorage.removeItem('fd_auth_user');
    clearDetectionCache();
    setState({
      token: null,
      user: null,
      isLoggedIn: false,
      isAdmin: false,
      roles: [],
      isLoading: false,
      error: null,
      errorCode: null,
    });
  }, []);

  // 监听 token 过期事件（来自 serverApi 的 401 响应），自动登出
  useEffect(() => {
    const handleTokenExpired = () => {
      console.warn('[useAuth] Token expired (401), logging out...');
      logout();
    };

    window.addEventListener('auth-token-expired', handleTokenExpired);
    return () => window.removeEventListener('auth-token-expired', handleTokenExpired);
  }, [logout]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null, errorCode: null }));
  }, []);

  // 角色检查
  const hasRole = useCallback((role: string): boolean => {
    if (!state.user) return false;
    return state.user.roles?.includes(role as UserRole) ?? state.user.role === role;
  }, [state.user]);

  // 权限检查（预留，当前基于角色判断，后续可改为从服务端获取精确权限）
  const hasPermission = useCallback((permission: string): boolean => {
    if (!state.user) return false;
    // SUPER_ADMIN 拥有所有权限
    if (hasRole('SUPER_ADMIN')) return true;
    // ADMIN 拥有所有权限
    if (hasRole('ADMIN')) return true;
    // USER 角色：ticket:read, ticket:translate, ticket:reply
    if (hasRole('USER')) {
      return ['ticket:read', 'ticket:translate', 'ticket:reply'].includes(permission);
    }
    // AUDITOR 角色
    if (hasRole('AUDITOR')) {
      return ['ticket:read', 'ticket:audit', 'ticket:push'].includes(permission);
    }
    return false;
  }, [state.user, hasRole]);

  return {
    ...state,
    login,
    register,
    oauthLogin,
    logout,
    clearError,
    hasRole,
    hasPermission,
  };
}

export default useAuth;
