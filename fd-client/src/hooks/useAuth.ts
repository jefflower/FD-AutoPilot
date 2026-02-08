/**
 * 认证状态管理 Hook
 */

import { useState, useEffect, useCallback } from 'react';
import { authApi, getAuthToken, setAuthToken, isTokenExpired } from '../services/serverApi';
import type { User, LoginRequest, RegisterRequest } from '../types/server';

interface AuthState {
  token: string | null;
  user: User | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    token: getAuthToken(),
    user: null,
    isLoggedIn: false,
    isAdmin: false,
    isLoading: true,
    error: null,
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
        setState({
          token,
          user,
          isLoggedIn: true,
          isAdmin: user.role === 'ADMIN',
          isLoading: false,
          error: null,
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
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await authApi.login(credentials);
      const user = response.user;
      
      // 检查 user 是否存在
      if (!user) {
        throw new Error('登录响应缺少用户信息');
      }
      
      localStorage.setItem('fd_auth_user', JSON.stringify(user));
      
      setState({
        token: response.token,
        user,
        isLoggedIn: true,
        isAdmin: user.role === 'ADMIN',
        isLoading: false,
        error: null,
      });
      
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
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

  const logout = useCallback(() => {
    authApi.logout();
    localStorage.removeItem('fd_auth_user');
    setState({
      token: null,
      user: null,
      isLoggedIn: false,
      isAdmin: false,
      isLoading: false,
      error: null,
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

  // 定时检查 token 是否过期（每 60 秒），处理使用过程中 token 到期的情况
  useEffect(() => {
    if (!state.isLoggedIn) return;

    const checkExpiry = () => {
      const token = getAuthToken();
      if (token && isTokenExpired(token)) {
        console.warn('[useAuth] Token expired during session, logging out...');
        logout();
      }
    };

    const interval = setInterval(checkExpiry, 60_000);
    return () => clearInterval(interval);
  }, [state.isLoggedIn, logout]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    login,
    register,
    logout,
    clearError,
  };
}

export default useAuth;
