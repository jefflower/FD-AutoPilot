/**
 * 工单相关 API（CRUD, translation, reply, audit）
 */
import type {
  TicketQueryParams,
  PaginatedTickets,
  ServerTicket,
  TranslationSubmitData,
  ReplySubmitData,
  AuditSubmitData,
  ValidityUpdateData,
  QueueCounts,
  MobileAuditDetail,
  MobileAuditSubmit,
  MobileAuditResult,
} from '../../types/server';
import { request, getApiBaseUrl, getAuthToken } from './client';

export const ticketApi = {
  async getTickets(params?: TicketQueryParams): Promise<PaginatedTickets> {
    const searchParams = new URLSearchParams();
    // camelCase -> snake_case 映射（后端 @RequestParam(name=...) 使用 snake_case）
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

  async restartWorkflow(id: number): Promise<void> {
    await request<void>(`/tickets/${id}/restart-workflow`, { method: 'POST' });
  },

  /** @deprecated 使用 restartWorkflow 替代 */
  async triggerAiTranslation(id: number): Promise<void> {
    await request<void>(`/tickets/${id}/ai-translate`, { method: 'POST' });
  },

  /** @deprecated 使用 restartWorkflow 替代 */
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

  async getAuditToken(ticketId: number): Promise<{ token: string }> {
    return request<{ token: string }>(`/tickets/${ticketId}/audit-token`);
  },

  /** 发送审核通知到钉钉/企微 */
  async notifyAudit(ticketId: number): Promise<void> {
    await request<any>(`/n8n/tickets/${ticketId}/notify-audit`, { method: 'POST' });
  },

  async getStatusHistory(ticketId: number): Promise<Array<{
    id: number;
    fromStatus: string | null;
    toStatus: string;
    triggeredBy: string;
    remark: string | null;
    createdAt: string;
  }>> {
    return (await request<any[]>(`/tickets/${ticketId}/status-history`)) || [];
  },
};

// ============ 移动审核 Token API（无需 JWT） ============
export const auditTokenApi = {
  async getDetail(token: string): Promise<MobileAuditDetail> {
    const url = `${getApiBaseUrl()}/audit-token/${encodeURIComponent(token)}`;
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.message || `请求失败: ${response.status}`);
    }
    const json = await response.json();
    return json.data ?? json;
  },

  async submitAudit(token: string, data: MobileAuditSubmit): Promise<MobileAuditResult> {
    const url = `${getApiBaseUrl()}/audit-token/${encodeURIComponent(token)}/submit`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.message || `提交失败: ${response.status}`);
    }
    const json = await response.json();
    return json.data ?? json;
  },
};

// ============ 下载辅助函数（Tauri / Web 兼容） ============
export async function downloadWithAuth(path: string, defaultFilename: string) {
  const { isTauriEnv } = await import('../../../tauri/bridge');

  // 1. 从服务端获取 CSV 文本
  const token = getAuthToken();
  const url = `${getApiBaseUrl()}${path}`;
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`下载失败: ${response.status}`);
  const text = await response.text();

  if (isTauriEnv()) {
    // Tauri 模式: 使用原生保存对话框
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const filePath = await save({
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      defaultPath: defaultFilename,
    });
    if (!filePath) return; // 用户取消
    await invoke('save_text_file_cmd', { savePath: filePath, content: text });
  } else {
    // Web 模式: 使用 Blob 下载
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  }
}
