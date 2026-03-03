/**
 * 知识库管理 API + NotebookLM Bridge 服务
 */
import type {
  KnowledgeBase,
  KnowledgeGroup,
  KnowledgeSource,
  KnowledgeSourceType,
  KnowledgePermission,
  KnowledgePermissionLevel,
  KnowledgeVisibility,
  NotebookInfo,
  RemoteSource,
} from '../../types/server';
import { request, getApiBaseUrl, getAuthToken } from './client';
import { tauriInvoke } from '../../../tauri/bridge';

// ============ 后端 REST API ============

export const knowledgeApi = {
  // ---- 主体 (Group) CRUD ----

  async listGroups(): Promise<KnowledgeGroup[]> {
    return request<KnowledgeGroup[]>('/knowledge-bases/groups');
  },

  async createGroup(data: { name: string; description?: string; color?: string; createdBy?: number }): Promise<KnowledgeGroup> {
    return request<KnowledgeGroup>('/knowledge-bases/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateGroup(id: number, data: { name?: string; description?: string; color?: string }): Promise<KnowledgeGroup> {
    return request<KnowledgeGroup>(`/knowledge-bases/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteGroup(id: number): Promise<void> {
    await request<void>(`/knowledge-bases/groups/${id}`, { method: 'DELETE' });
  },

  async toggleGroupVisibility(id: number, visibility: KnowledgeVisibility): Promise<KnowledgeGroup> {
    return request<KnowledgeGroup>(`/knowledge-bases/groups/${id}/visibility`, {
      method: 'PUT',
      body: JSON.stringify({ visibility }),
    });
  },

  // ---- 权限管理 ----

  async getGroupPermissions(groupId: number): Promise<KnowledgePermission[]> {
    return request<KnowledgePermission[]>(`/knowledge-bases/groups/${groupId}/permissions`);
  },

  async addGroupPermission(groupId: number, userId: number, permission: KnowledgePermissionLevel): Promise<KnowledgePermission> {
    return request<KnowledgePermission>(`/knowledge-bases/groups/${groupId}/permissions`, {
      method: 'POST',
      body: JSON.stringify({ userId, permission }),
    });
  },

  async removeGroupPermission(groupId: number, permissionId: number): Promise<void> {
    await request<void>(`/knowledge-bases/groups/${groupId}/permissions/${permissionId}`, { method: 'DELETE' });
  },

  // ---- 知识库 CRUD ----

  async listBases(groupId?: number): Promise<KnowledgeBase[]> {
    const url = groupId ? `/knowledge-bases?groupId=${groupId}` : '/knowledge-bases';
    return request<KnowledgeBase[]>(url);
  },

  async createBase(data: { name: string; description?: string; notebookId?: string; color?: string; groupId?: number; createdBy?: number }): Promise<KnowledgeBase> {
    return request<KnowledgeBase>('/knowledge-bases', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getBase(id: number): Promise<KnowledgeBase> {
    return request<KnowledgeBase>(`/knowledge-bases/${id}`);
  },

  async updateBase(id: number, data: Partial<KnowledgeBase>): Promise<KnowledgeBase> {
    return request<KnowledgeBase>(`/knowledge-bases/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteBase(id: number): Promise<void> {
    await request<void>(`/knowledge-bases/${id}`, { method: 'DELETE' });
  },

  // ---- 源管理 ----

  async listSources(baseId: number): Promise<KnowledgeSource[]> {
    return request<KnowledgeSource[]>(`/knowledge-bases/${baseId}/sources`);
  },

  async uploadFile(baseId: number, file: File): Promise<KnowledgeSource> {
    const formData = new FormData();
    formData.append('file', file);
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${getApiBaseUrl()}/knowledge-bases/${baseId}/sources/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Upload failed: ${response.status}`);
    }
    return response.json();
  },

  async addTextSource(baseId: number, data: { title: string; sourceType: KnowledgeSourceType; content?: string; url?: string }): Promise<KnowledgeSource> {
    return request<KnowledgeSource>(`/knowledge-bases/${baseId}/sources/text`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getSource(baseId: number, sourceId: number): Promise<KnowledgeSource> {
    return request<KnowledgeSource>(`/knowledge-bases/${baseId}/sources/${sourceId}`);
  },

  async updateSource(baseId: number, sourceId: number, data: { title?: string; content?: string; preserveSyncStatus?: boolean }): Promise<KnowledgeSource> {
    return request<KnowledgeSource>(`/knowledge-bases/${baseId}/sources/${sourceId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteSource(baseId: number, sourceId: number): Promise<void> {
    await request<void>(`/knowledge-bases/${baseId}/sources/${sourceId}`, { method: 'DELETE' });
  },

  // ---- 同步 ----

  async syncAll(baseId: number): Promise<KnowledgeSource[]> {
    return request<KnowledgeSource[]>(`/knowledge-bases/${baseId}/sync`, {
      method: 'POST',
    });
  },

  async syncSource(baseId: number, sourceId: number): Promise<KnowledgeSource> {
    return request<KnowledgeSource>(`/knowledge-bases/${baseId}/sources/${sourceId}/sync`, {
      method: 'POST',
    });
  },

  async updateSyncStatus(baseId: number, sourceId: number, data: { notebookSourceId?: string; status: string }): Promise<KnowledgeSource> {
    return request<KnowledgeSource>(`/knowledge-bases/${baseId}/sources/${sourceId}/sync-status`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async savePulledSources(baseId: number, remoteSources: Record<string, unknown>[]): Promise<KnowledgeSource[]> {
    return request<KnowledgeSource[]>(`/knowledge-bases/${baseId}/pull`, {
      method: 'POST',
      body: JSON.stringify(remoteSources),
    });
  },

  async getSyncStatus(baseId: number): Promise<{ total: number; synced: number; notSynced: number; failed: number }> {
    return request<{ total: number; synced: number; notSynced: number; failed: number }>(`/knowledge-bases/${baseId}/sync-status`);
  },

  // ---- 兼容旧代码 ---- (旧 KnowledgeBasePage 仍引用这些方法)

  /** @deprecated 使用 notebookLmBridge.listNotebooks() 替代 */
  async listNotebooks(): Promise<NotebookInfo[]> {
    // 通过 Bridge 获取（旧版通过后端请求，现在改为 Bridge 直调）
    try {
      const { notebookLmBridge: bridge } = await import('./knowledge');
      return bridge.listNotebooks();
    } catch {
      return [];
    }
  },

  /** @deprecated 使用 notebookLmBridge.listSources() + savePulledSources() 替代 */
  async pullFromNotebookLm(_baseId: number): Promise<{ imported: number }> {
    return { imported: 0 };
  },
};

// ============ 辅助函数 ============

/** 清洗 NotebookLM CLI 返回的源类型，如 "SourceType.PDF" → "PDF" */
function normalizeSourceType(raw?: string): string {
  if (!raw) return 'TEXT';
  // 去掉 "SourceType." 前缀
  const cleaned = raw.replace(/^SourceType\./i, '').toUpperCase();
  // 映射常见变体
  switch (cleaned) {
    case 'PDF': return 'PDF';
    case 'CSV': return 'CSV';
    case 'PASTED_TEXT': case 'TEXT': return 'TEXT';
    case 'WEBSITE': case 'URL': return 'URL';
    case 'MARKDOWN': case 'MD': return 'MARKDOWN';
    default: return 'TEXT';
  }
}

// ============ NotebookLM Bridge 服务（前端直调 fd-bridge CLI）============

export const notebookLmBridge = {
  /** 列出所有 NotebookLM 笔记本 */
  async listNotebooks(): Promise<NotebookInfo[]> {
    const result = await tauriInvoke<string>('execute_notebooklm_cli_cmd', {
      action: 'list-notebooks',
    });
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    // notebooklm list --json → { notebooks: [...] }
    const notebooks = parsed.notebooks || parsed || [];
    return notebooks.map((n: any) => ({
      id: n.id,
      title: n.title,
      isOwner: n.is_owner ?? true,
      createdAt: n.created_at || '',
    }));
  },

  /** 列出笔记本下的所有源 */
  async listSources(notebookId: string): Promise<RemoteSource[]> {
    const result = await tauriInvoke<string>('execute_notebooklm_cli_cmd', {
      action: 'list-sources',
      notebookId,
    });
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const sources = parsed.sources || parsed || [];
    return sources.map((s: any) => ({
      id: s.id,
      title: s.title,
      status: s.status || 'unknown',
      type: normalizeSourceType(s.type),
    }));
  },

  /** 添加源到笔记本 */
  async addSource(notebookId: string, contentOrPath: string, sourceType: string, title?: string): Promise<RemoteSource> {
    const result = await tauriInvoke<string>('execute_notebooklm_cli_cmd', {
      action: 'add-source',
      notebookId,
      contentOrPath,
      sourceType,
      title,
    });
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    return {
      id: parsed.source_id || parsed.id,
      title: parsed.title || title || '',
      status: parsed.status || 'processing',
      type: sourceType,
    };
  },

  /** 删除笔记本中的源 */
  async deleteSource(notebookId: string, sourceId: string): Promise<void> {
    await tauriInvoke<string>('execute_notebooklm_cli_cmd', {
      action: 'delete-source',
      notebookId,
      sourceId,
    });
  },

  /** 获取源的全文内容 */
  async getFulltext(notebookId: string, sourceId: string): Promise<string> {
    const result = await tauriInvoke<string>('execute_notebooklm_cli_cmd', {
      action: 'source-fulltext',
      notebookId,
      sourceId,
    });
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    return parsed.content || parsed.text || '';
  },
};
