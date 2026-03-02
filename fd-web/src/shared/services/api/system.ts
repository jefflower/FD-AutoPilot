/**
 * 系统配置、管理员、知识库、用户设置、RBAC、Actuator、组织架构同步、OAuth API
 */
import type {
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
  KnowledgeSyncConfig,
  SysRole,
  SysPermission,
  SysModule,
  PermissionOverview,
  NotifyChannelConfig,
  OrgSyncConfig,
  OrgSyncResult,
  OrgSyncLog,
  SysDepartment,
  OAuthStatus,
  LoginResponse,
} from '../../types/server';
import { request, getActuatorBaseUrl, getAuthToken, setAuthToken, setRefreshToken } from './client';

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
    return request<PaginatedUsers>(`/auth/users${query ? `?${query}` : ''}`);
  },

  async getPendingUsers(): Promise<User[]> {
    return request<User[]>('/auth/users/pending');
  },

  async approveUser(userId: number, action: 'APPROVE' | 'REJECT'): Promise<void> {
    await request<void>(`/auth/users/${userId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  },

  async updateUserRole(userId: number, role: string): Promise<void> {
    await request<void>(`/auth/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
  },

  async resetPassword(userId: number, password: string): Promise<void> {
    await request<void>(`/auth/users/${userId}/reset-password`, {
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

  // ---- 用户角色/权限管理 (新 auth 路径) ----

  async getUserRoles(userId: number): Promise<string[]> {
    return request<string[]>(`/auth/users/${userId}/roles`);
  },

  async setUserRoles(userId: number, roleCodes: string[]): Promise<void> {
    await request<void>(`/auth/users/${userId}/roles`, {
      method: 'PUT',
      body: JSON.stringify(roleCodes),
    });
  },

  async getUserPermissions(userId: number): Promise<string[]> {
    return request<string[]>(`/auth/users/${userId}/permissions`);
  },
};

// ============ RBAC API（角色、权限、模块） ============
export const rbacApi = {
  async getRoles(): Promise<SysRole[]> {
    return request<SysRole[]>('/auth/roles');
  },

  async getRolePermissions(roleId: number): Promise<string[]> {
    return request<string[]>(`/auth/roles/${roleId}/permissions`);
  },

  async setRolePermissions(roleId: number, permissionCodes: string[]): Promise<void> {
    await request<void>(`/auth/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify(permissionCodes),
    });
  },

  async getPermissions(): Promise<SysPermission[]> {
    return request<SysPermission[]>('/auth/permissions');
  },

  async createPermission(data: {
    code: string;
    name: string;
    module: string;
    description?: string;
    type?: string;
  }): Promise<SysPermission> {
    return request<SysPermission>('/auth/permissions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updatePermission(
    id: number,
    data: {
      name?: string;
      description?: string;
      type?: string;
    }
  ): Promise<SysPermission> {
    return request<SysPermission>(`/auth/permissions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deletePermission(id: number): Promise<void> {
    await request<void>(`/auth/permissions/${id}`, {
      method: 'DELETE',
    });
  },

  async getModules(): Promise<SysModule[]> {
    return request<SysModule[]>('/auth/modules');
  },

  async toggleModule(moduleId: number, enabled: boolean): Promise<SysModule> {
    return request<SysModule>(`/auth/modules/${moduleId}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  },

  async getPermissionOverview(): Promise<PermissionOverview> {
    return request<PermissionOverview>('/auth/permission-overview');
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

  async getNotifyChannel(): Promise<NotifyChannelConfig> {
    return request<NotifyChannelConfig>('/config/notify-channel');
  },

  async setNotifyChannel(config: Partial<NotifyChannelConfig>): Promise<void> {
    await request<void>('/config/notify-channel', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async testNotifyChannel(): Promise<{ success: boolean; error?: string }> {
    return request<{ success: boolean; error?: string }>('/config/notify-channel/test', {
      method: 'POST',
    });
  },

  async getN8nConfig(): Promise<{ enabled: boolean; url: string }> {
    return request<{ enabled: boolean; url: string }>('/config/n8n');
  },

  async getNotebookLmConfig(): Promise<{ defaultNotebookId: string; notebookMapping: string }> {
    return (await request<{ defaultNotebookId: string; notebookMapping: string }>('/config/notebooklm'))
        || { defaultNotebookId: '', notebookMapping: '{}' };
  },

  async setNotebookLmConfig(config: { defaultNotebookId?: string; notebookMapping?: string }): Promise<void> {
    await request<void>('/config/notebooklm', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async getNotifyLanguage(): Promise<{ language: string }> {
    return (await request<{ language: string }>('/config/notify-language')) || { language: 'zh-CN' };
  },

  async setNotifyLanguage(language: string): Promise<void> {
    await request<void>('/config/notify-language', {
      method: 'PUT',
      body: JSON.stringify({ language }),
    });
  },

  async getKnowledgeSyncConfig(): Promise<KnowledgeSyncConfig> {
    return (await request<KnowledgeSyncConfig>('/config/knowledge-sync')) || {};
  },

  async setKnowledgeSyncConfig(config: KnowledgeSyncConfig): Promise<void> {
    await request<void>('/config/knowledge-sync', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },
};

// ============ 用户设置 API ============
export const userSettingsApi = {
  async getSettings(appCode: string): Promise<string | null> {
    return request<string | null>(`/user/settings/${appCode}`);
  },
  async saveSettings(appCode: string, settingsJson: string): Promise<void> {
    await request<string>(`/user/settings/${appCode}`, {
      method: 'PUT',
      body: settingsJson,
    });
  },
  async deleteSettings(appCode: string): Promise<void> {
    await request<void>(`/user/settings/${appCode}`, { method: 'DELETE' });
  },
};

// ============ 组织架构同步 API ============
export const orgSyncApi = {
  async getConfig(): Promise<OrgSyncConfig> {
    return request<OrgSyncConfig>('/auth/org-sync/config');
  },

  async saveConfig(config: OrgSyncConfig): Promise<void> {
    await request<void>('/auth/org-sync/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async triggerSync(): Promise<OrgSyncResult> {
    return request<OrgSyncResult>('/auth/org-sync/trigger', {
      method: 'POST',
    });
  },

  async testConnection(): Promise<{ success: boolean }> {
    return request<{ success: boolean }>('/auth/org-sync/test-connection', {
      method: 'POST',
    });
  },

  async getSyncLogs(): Promise<OrgSyncLog[]> {
    return request<OrgSyncLog[]>('/auth/org-sync/logs');
  },

  async getDepartments(): Promise<SysDepartment[]> {
    return request<SysDepartment[]>('/auth/org-sync/departments');
  },
};

// ============ OAuth API ============
export const oauthApi = {
  async getStatus(): Promise<OAuthStatus> {
    return request<OAuthStatus>('/auth/oauth/status');
  },

  async getOAuthUrl(platform: string, redirectUri: string): Promise<string> {
    const data = await request<{ url: string }>(`/auth/oauth/${platform}/url?redirectUri=${encodeURIComponent(redirectUri)}`);
    return data.url;
  },

  async oauthCallback(platform: string, authCode: string): Promise<LoginResponse> {
    const response = await request<LoginResponse>(`/auth/oauth/${platform}/callback`, {
      method: 'POST',
      body: JSON.stringify({ authCode }),
    });
    setAuthToken(response.accessToken || response.token);
    setRefreshToken(response.refreshToken);
    return response;
  },
};
