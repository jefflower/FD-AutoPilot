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
} from '../types/server';

const API_BASE_URL = 'http://localhost:9988/api/v1';

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
    return request<ServerTicket>(`/tickets/${id}`);
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
};

// 导出所有 API
export const serverApi = {
  auth: authApi,
  ticket: ticketApi,
  admin: adminApi,
};

export default serverApi;
