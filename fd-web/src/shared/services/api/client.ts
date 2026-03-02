/**
 * HTTP 客户端：fetch 封装、JWT 拦截器、Token 管理
 */

// 自定义 API 错误类，携带错误码
export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }
}

// Server URL（从 localStorage 读取）
// 同源部署时（前端由 fd-server 托管）使用相对路径，无需配置
// 分离部署时，用户在设置页面填写服务端地址
const DEFAULT_SERVER_URL = '';  // 空字符串 = 相对路径（同源模式）
let serverBaseUrl: string = localStorage.getItem('fd_server_url') ?? DEFAULT_SERVER_URL;

export const getApiBaseUrl = () => `${serverBaseUrl}/api/v1`;
export const getActuatorBaseUrl = () => `${serverBaseUrl}/actuator`;

export const setServerBaseUrl = (url: string) => {
  serverBaseUrl = url.replace(/\/+$/, '');
  if (serverBaseUrl) {
    localStorage.setItem('fd_server_url', serverBaseUrl);
  } else {
    localStorage.removeItem('fd_server_url');
  }
};

export const getServerBaseUrl = (): string => serverBaseUrl;

// Token 存储
let authToken: string | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    localStorage.setItem('fd_auth_token', token);
  } else {
    localStorage.removeItem('fd_auth_token');
  }
};

export const getAuthToken = (): string | null => {
  if (!authToken) {
    authToken = localStorage.getItem('fd_auth_token');
  }
  return authToken;
};

// Refresh Token 存储
let refreshTokenValue: string | null = null;

export const setRefreshToken = (token: string | null) => {
  refreshTokenValue = token;
  if (token) {
    localStorage.setItem('fd_auth_refresh_token', token);
  } else {
    localStorage.removeItem('fd_auth_refresh_token');
  }
};

export const getRefreshToken = (): string | null => {
  if (!refreshTokenValue) {
    refreshTokenValue = localStorage.getItem('fd_auth_refresh_token');
  }
  return refreshTokenValue;
};

/**
 * 解析 JWT payload 中的 exp 字段，判断 token 是否已过期
 */
export const isTokenExpired = (token: string): boolean => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return false; // 没有 exp 字段则不判断过期
    // exp 是秒级时间戳，留 30 秒缓冲
    return payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
};

// Token 自动刷新（防止并发刷新）
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  // 防止并发刷新
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  const rt = getRefreshToken();
  if (!rt) return false;

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });

      if (!response.ok) {
        return false;
      }

      const json = await response.json();
      const data = json.data || json;

      setAuthToken(data.accessToken || data.token);
      setRefreshToken(data.refreshToken);

      // 更新本地存储的用户信息
      if (data.user) {
        localStorage.setItem('fd_auth_user', JSON.stringify(data.user));
      }

      return true;
    } catch {
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// 通用请求方法
export async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  explicitToken?: string
): Promise<T> {
  let token = explicitToken || getAuthToken();

  // 自动刷新逻辑（不用于 /auth/refresh 和 /auth/login 本身）
  if (token && isTokenExpired(token) && !endpoint.includes('/auth/refresh') && !endpoint.includes('/auth/login')) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      token = getAuthToken();
    } else {
      // 刷新失败，触发登出
      setAuthToken(null);
      setRefreshToken(null);
      window.dispatchEvent(new CustomEvent('auth-token-expired'));
      throw new ApiError('TOKEN_EXPIRED', 'Token 已过期且刷新失败');
    }
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    // Token 过期或无效，触发全局登出
    if (response.status === 401) {
      setAuthToken(null);
      window.dispatchEvent(new CustomEvent('auth-token-expired'));
    }

    const errorData: { error?: string; message?: string } = await response.json().catch(() => ({
      error: 'UNKNOWN_ERROR',
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));
    throw new ApiError(errorData.error || 'UNKNOWN_ERROR', errorData.message || `Request failed: ${response.status}`);
  }

  // 处理空响应
  const text = await response.text();
  if (!text) {
    return undefined as unknown as T;
  }

  // 解析 ApiResponse 格式: { success, message, data }
  const jsonResponse = JSON.parse(text);

  // 如果返回有 data 字段且 success 为 true，提取 data
  if (jsonResponse && typeof jsonResponse === 'object' && 'success' in jsonResponse) {
    if (!jsonResponse.success) {
      throw new Error(jsonResponse.message || '请求失败');
    }
    return jsonResponse.data as T;
  }

  // 否则直接返回
  return jsonResponse as T;
}
