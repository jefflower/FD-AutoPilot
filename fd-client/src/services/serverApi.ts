/**
 * 服务端 API 服务封装
 * 对应 system-design.md 中的 API 设计
 */

import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  TicketQueryParams,
  PaginatedTickets,
  ServerTicket,
  TranslationSubmitData,
  ReplySubmitData,
  AuditSubmitData,
  ValidityUpdateData,
  UserQueryParams,
  PaginatedUsers,
  User,
  SyncResult,
  SyncConfig,
  SyncConfigUpdate,
  SyncStatus,
  PaginatedSyncLogs,
  SqlQueryResult,
  TableInfo,
} from '../types/server';

const API_BASE_URL = 'http://localhost:9988/api/v1';
const ACTUATOR_BASE_URL = 'http://localhost:9988/actuator';

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

// 通用请求方法
async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  explicitToken?: string
): Promise<T> {
  const token = explicitToken || getAuthToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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
    throw new Error(errorData.message || `Request failed: ${response.status}`);
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

// ============ 认证 API ============
export const authApi = {
  async login(data: LoginRequest): Promise<LoginResponse> {
    const response = await request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setAuthToken(response.token);
    return response;
  },

  async register(data: RegisterRequest): Promise<void> {
    await request<void>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  logout() {
    setAuthToken(null);
  },
};

// ============ 工单 API ============
export const ticketApi = {
  async getTickets(params?: TicketQueryParams): Promise<PaginatedTickets> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return request<PaginatedTickets>(`/tickets${query ? `?${query}` : ''}`);
  },

  async getTicketById(id: number): Promise<ServerTicket> {
    return request<ServerTicket>(`/tickets/${id}?_t=${Date.now()}`);
  },

  async getTicketDetail(id: number): Promise<ServerTicket> {
    return this.getTicketById(id);
  },

  async submitTranslation(ticketId: number, data: TranslationSubmitData): Promise<void> {
    await request<void>(`/tickets/${ticketId}/translation`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async submitReply(ticketId: number, data: ReplySubmitData, explicitToken?: string): Promise<void> {
    await request<void>(`/tickets/${ticketId}/reply`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, explicitToken);
  },

  async submitAudit(ticketId: number, data: AuditSubmitData): Promise<void> {
    await request<void>(`/tickets/${ticketId}/audit`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateValidity(ticketId: number, data: ValidityUpdateData): Promise<void> {
    await request<void>(`/tickets/${ticketId}/valid`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async triggerAiTranslation(id: number): Promise<void> {
    await request<void>(`/tickets/${id}/ai-translate`, { method: 'POST' });
  },

  async triggerAiReply(id: number): Promise<void> {
    await request<void>(`/tickets/${id}/ai-reply`, { method: 'POST' });
  },
};

// ============ 管理员 API ============
export const adminApi = {
  async getAllUsers(params?: UserQueryParams): Promise<PaginatedUsers> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return request<PaginatedUsers>(`/admin/users${query ? `?${query}` : ''}`);
  },

  async getPendingUsers(): Promise<User[]> {
    return request<User[]>('/admin/users/pending');
  },

  async approveUser(userId: number, action: 'APPROVE' | 'REJECT'): Promise<void> {
    await request<void>(`/admin/users/${userId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  },

  async triggerSync(): Promise<SyncResult> {
    return request<SyncResult>('/sync/freshdesk', {
      method: 'POST',
    });
  },

  async getSyncConfig(): Promise<SyncConfig> {
    return request<SyncConfig>('/sync/config');
  },

  async updateSyncConfig(config: Partial<SyncConfigUpdate>): Promise<void> {
    await request<void>('/sync/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async getSyncStatus(): Promise<SyncStatus> {
    return request<SyncStatus>('/sync/status');
  },

  async getSyncLogs(page = 0, size = 10): Promise<PaginatedSyncLogs> {
    return request<PaginatedSyncLogs>(`/sync/logs?page=${page}&size=${size}`);
  },

  async executeSql(sql: string, maxRows?: number): Promise<SqlQueryResult> {
    return request<SqlQueryResult>('/admin/database/query', {
      method: 'POST',
      body: JSON.stringify({ sql, maxRows }),
    });
  },

  async getDatabaseTables(): Promise<TableInfo[]> {
    return request<TableInfo[]>('/admin/database/tables');
  },
};

// ============ Actuator API（日志查看、运行时监控） ============
export const actuatorApi = {
  /** 获取日志文件内容（纯文本） */
  async fetchLogfile(sizeKB = 200): Promise<string> {
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // 用 Range header 只取最后 N KB，避免日志文件过大
    headers['Range'] = `bytes=-${sizeKB * 1024}`;

    const response = await fetch(`${ACTUATOR_BASE_URL}/logfile`, { headers });
    if (!response.ok && response.status !== 206) {
      throw new Error(`获取日志失败: ${response.status}`);
    }
    return response.text();
  },

  /** 获取所有 logger 及级别 */
  async getLoggers(): Promise<Record<string, { configuredLevel: string | null; effectiveLevel: string }>> {
    const token = getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${ACTUATOR_BASE_URL}/loggers`, { headers });
    if (!response.ok) throw new Error(`获取 loggers 失败: ${response.status}`);
    const data = await response.json();
    return data.loggers;
  },

  /** 动态修改 logger 级别 */
  async setLoggerLevel(loggerName: string, level: string): Promise<void> {
    const token = getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${ACTUATOR_BASE_URL}/loggers/${encodeURIComponent(loggerName)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ configuredLevel: level }),
    });
    if (!response.ok) throw new Error(`设置日志级别失败: ${response.status}`);
  },
};

// 导出所有 API
export const serverApi = {
  auth: authApi,
  ticket: ticketApi,
  admin: adminApi,
  actuator: actuatorApi,
};

export default serverApi;
