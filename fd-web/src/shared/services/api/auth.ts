/**
 * 认证 API
 */
import type { LoginRequest, LoginResponse, RegisterRequest } from '../../types/server';
import { request, setAuthToken, setRefreshToken, getAuthToken, getRefreshToken, getApiBaseUrl, ApiError } from './client';

export const authApi = {
  async login(data: LoginRequest): Promise<LoginResponse> {
    const response = await request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    // 存储双 Token
    setAuthToken(response.accessToken || response.token);
    setRefreshToken(response.refreshToken);
    return response;
  },

  async register(data: RegisterRequest): Promise<void> {
    await request<void>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async checkAdmin(): Promise<{ exists: boolean }> {
    return request<{ exists: boolean }>('/auth/check-admin');
  },

  async initAdmin(data: { password: string; superPassword: string }): Promise<void> {
    await request<void>('/auth/init-admin', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async superResetPassword(data: { username: string; newPassword: string; superPassword: string }): Promise<void> {
    await request<void>('/auth/super-reset-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async refreshToken(): Promise<LoginResponse> {
    const rt = getRefreshToken();
    if (!rt) throw new ApiError('NO_REFRESH_TOKEN', '无 Refresh Token');

    const response = await request<LoginResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: rt }),
    });

    setAuthToken(response.accessToken || response.token);
    setRefreshToken(response.refreshToken);
    return response;
  },

  logout() {
    // 尝试通知服务端（best effort，fire-and-forget）
    const token = getAuthToken();
    if (token) {
      fetch(`${getApiBaseUrl()}/auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }).catch(() => {}); // 忽略错误
    }
    setAuthToken(null);
    setRefreshToken(null);
  },
};
