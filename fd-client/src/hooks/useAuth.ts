/**
 * 认证状态管理 Hook
 */

import { useState, useEffect, useCallback } from 'react';
import { authApi, getAuthToken, setAuthToken } from '../services/serverApi';
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

  // 初始化时检查本地存储的 token
  useEffect(() => {
    const token = getAuthToken();
    const savedUser = localStorage.getItem('fd_auth_user');
    
    if (token && savedUser) {
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
