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
  KnowledgeNote,
  KnowledgeNoteRequest,
  QueueCounts,
} from '../types/server';

// 自定义 API 错误类，携带错误码
export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }
}

// Server URL（从 localStorage 读取，默认 http://localhost:9988）
const DEFAULT_SERVER_URL = 'http://47.110.152.25:9988';
let serverBaseUrl: string = localStorage.getItem('fd_server_url') || DEFAULT_SERVER_URL;

const getApiBaseUrl = () => `${serverBaseUrl}/api/v1`;
const getActuatorBaseUrl = () => `${serverBaseUrl}/actuator`;

export const setServerBaseUrl = (url: string) => {
  // 去掉末尾斜杠
  serverBaseUrl = url.replace(/\/+$/, '') || DEFAULT_SERVER_URL;
  localStorage.setItem('fd_server_url', serverBaseUrl);
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

  logout() {
    setAuthToken(null);
  },
};

// ============ 工单 API ============
export const ticketApi = {
  async getTickets(params?: TicketQueryParams): Promise<PaginatedTickets> {
    const searchParams = new URLSearchParams();
    // camelCase → snake_case 映射（后端 @RequestParam(name=...) 使用 snake_case）
    const keyMap: Record<string, string> = {
      isValid: 'is_valid',
      externalId: 'external_id',
      createdAfter: 'created_after',
      createdBefore: 'created_before',
    };
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(keyMap[key] || key, String(value));
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

  async updateReply(ticketId: number, replyId: number, data: ReplySubmitData): Promise<void> {
    await request<void>(`/tickets/${ticketId}/reply/${replyId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
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

  async skipReply(ticketId: number): Promise<void> {
    await request<void>(`/tickets/${ticketId}/skip-reply`, { method: 'POST' });
  },

  async triggerAiTranslation(id: number): Promise<void> {
    await request<void>(`/tickets/${id}/ai-translate`, { method: 'POST' });
  },

  async triggerAiReply(id: number): Promise<void> {
    await request<void>(`/tickets/${id}/ai-reply`, { method: 'POST' });
  },

  async pushReply(ticketId: number): Promise<void> {
    await request<void>(`/tickets/${ticketId}/push-reply`, { method: 'POST' });
  },

  async batchPushReplies(ticketIds: number[]): Promise<number> {
    return request<number>('/tickets/batch-push', {
      method: 'POST',
      body: JSON.stringify(ticketIds),
    });
  },

  async getQueueCounts(): Promise<QueueCounts> {
    return request<QueueCounts>('/tickets/queue-counts');
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

  async updateUserRole(userId: number, role: 'ADMIN' | 'USER'): Promise<void> {
    await request<void>(`/admin/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
  },

  async resetPassword(userId: number, password: string): Promise<void> {
    await request<void>(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
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

  // ---- 知识库 API ----

  async getKnowledgeNotes(): Promise<KnowledgeNote[]> {
    return request<KnowledgeNote[]>('/admin/knowledge/notes');
  },

  async createKnowledgeNote(data: KnowledgeNoteRequest): Promise<KnowledgeNote> {
    return request<KnowledgeNote>('/admin/knowledge/notes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateKnowledgeNote(id: number, data: KnowledgeNoteRequest): Promise<KnowledgeNote> {
    return request<KnowledgeNote>(`/admin/knowledge/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteKnowledgeNote(id: number): Promise<void> {
    await request<void>(`/admin/knowledge/notes/${id}`, { method: 'DELETE' });
  },

  async batchUpdateValidity(ticketIds: number[], isValid: boolean): Promise<number> {
    return request<number>('/admin/knowledge/batch-valid', {
      method: 'POST',
      body: JSON.stringify({ ticketIds, isValid }),
    });
  },

  async purgeQueues(superPassword: string): Promise<{ purgedMessages: number; resetTickets: number }> {
    return request<{ purgedMessages: number; resetTickets: number }>('/admin/queues/purge', {
      method: 'POST',
      body: JSON.stringify({ superPassword }),
    });
  },

  async purgeAllTickets(superPassword: string): Promise<{ deletedTickets: number }> {
    return request<{ deletedTickets: number }>('/admin/tickets/purge-all', {
      method: 'POST',
      body: JSON.stringify({ superPassword }),
    });
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

    const response = await fetch(`${getActuatorBaseUrl()}/logfile`, { headers });
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

    const response = await fetch(`${getActuatorBaseUrl()}/loggers`, { headers });
    if (!response.ok) throw new Error(`获取 loggers 失败: ${response.status}`);
    const data = await response.json();
    return data.loggers;
  },

  /** 动态修改 logger 级别 */
  async setLoggerLevel(loggerName: string, level: string): Promise<void> {
    const token = getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${getActuatorBaseUrl()}/loggers/${encodeURIComponent(loggerName)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ configuredLevel: level }),
    });
    if (!response.ok) throw new Error(`设置日志级别失败: ${response.status}`);
  },
};

// ============ 系统配置 API ============
export const configApi = {
  async getAutoReply(): Promise<{ enabled: boolean }> {
    return request<{ enabled: boolean }>('/config/auto-reply');
  },

  async setAutoReply(enabled: boolean): Promise<void> {
    await request<void>('/config/auto-reply', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  },

  async getWeComWebhook(): Promise<{ url: string; enabled: boolean }> {
    return request<{ url: string; enabled: boolean }>('/config/wecom-webhook');
  },

  async setWeComWebhook(url: string, enabled: boolean): Promise<void> {
    await request<void>('/config/wecom-webhook', {
      method: 'PUT',
      body: JSON.stringify({ url, enabled }),
    });
  },

  async testWeComWebhook(): Promise<{ success: boolean }> {
    return request<{ success: boolean }>('/config/wecom-webhook/test', {
      method: 'POST',
    });
  },

  async getMqQueues(): Promise<Record<string, string>> {
    return request<Record<string, string>>('/config/mq-queues');
  },

  async setMqQueues(config: Record<string, string>): Promise<void> {
    await request<void>('/config/mq-queues', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },
};

// ============ 下载辅助函数（Tauri 兼容） ============
export async function downloadWithAuth(path: string, defaultFilename: string) {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');

  // 1. 弹出保存对话框
  const filePath = await save({
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    defaultPath: defaultFilename,
  });
  if (!filePath) return; // 用户取消

  // 2. 从服务端获取 CSV 文本
  const token = getAuthToken();
  const url = `${getApiBaseUrl()}${path}`;
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`下载失败: ${response.status}`);
  const text = await response.text();

  // 3. 通过 Tauri 命令写入文件
  await invoke('save_text_file_cmd', { savePath: filePath, content: text });
}

// 导出所有 API
export const serverApi = {
  auth: authApi,
  ticket: ticketApi,
  admin: adminApi,
  actuator: actuatorApi,
  config: configApi,
};

export default serverApi;
