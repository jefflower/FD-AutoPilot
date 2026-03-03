/**
 * Agent 相关 API（definition, instance, execution, binding）
 */
import type {
  AgentDefinition,
  AgentBindings,
  AgentExecutionReport,
  AgentExecutionLog,
  AgentExecution,
  AgentStats,
  AgentProxyTestResult,
  AgentInstance,
} from '../../types/server';
import { request, getApiBaseUrl, getAuthToken } from './client';

export const agentApi = {
  async getDefinitions(): Promise<AgentDefinition[]> {
    return (await request<AgentDefinition[]>('/agents/definitions')) || [];
  },

  async getAllDefinitions(): Promise<AgentDefinition[]> {
    return (await request<AgentDefinition[]>('/agents/definitions/all')) || [];
  },

  async getClientAgents(): Promise<AgentDefinition[]> {
    return (await request<AgentDefinition[]>('/agents/definitions/client')) || [];
  },

  async createDefinition(def: Partial<AgentDefinition>): Promise<AgentDefinition> {
    return request<AgentDefinition>('/agents/definitions', {
      method: 'POST',
      body: JSON.stringify(def),
    });
  },

  async updateDefinition(id: number, def: Partial<AgentDefinition>): Promise<AgentDefinition> {
    return request<AgentDefinition>(`/agents/definitions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(def),
    });
  },

  async toggleDefinition(id: number): Promise<void> {
    await request<void>(`/agents/definitions/${id}/toggle`, { method: 'PUT' });
  },

  async deleteDefinition(id: number): Promise<void> {
    await request<void>(`/agents/definitions/${id}`, { method: 'DELETE' });
  },

  async getBindings(): Promise<AgentBindings> {
    return (await request<AgentBindings>('/agents/bindings')) || {};
  },

  async setBinding(capability: string, agentCode: string): Promise<void> {
    await request<void>(`/agents/bindings/${capability}`, {
      method: 'PUT',
      body: JSON.stringify({ agentCode }),
    });
  },

  async removeBinding(capability: string): Promise<void> {
    await request<void>(`/agents/bindings/${capability}`, {
      method: 'DELETE',
    });
  },

  async getByGroupCode(groupCode: string): Promise<AgentDefinition[]> {
    return (await request<AgentDefinition[]>(`/agents/definitions/group/${groupCode}`)) || [];
  },

  async getGroupCodes(): Promise<string[]> {
    return (await request<string[]>('/agents/definitions/groups')) || [];
  },

  async testProxy(baseUrl: string, apiKey?: string): Promise<AgentProxyTestResult> {
    return request<AgentProxyTestResult>('/agents/definitions/test-proxy', {
      method: 'POST',
      body: JSON.stringify({ baseUrl, apiKey: apiKey || '' }),
    });
  },

  async executeAgent(code: string, req: { input: string; referenceType?: string; referenceId?: number }): Promise<{ success: boolean; output: string; tokenCount?: number; errorMessage?: string }> {
    return request<{ success: boolean; output: string; tokenCount?: number; errorMessage?: string }>(`/agents/execute/${code}`, {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async reportExecution(report: AgentExecutionReport): Promise<void> {
    try {
      await request<void>('/agents/executions/report', {
        method: 'POST',
        body: JSON.stringify(report),
      });
    } catch {
      // 上报失败不阻塞业务
    }
  },

  async getExecutions(params?: { agentCode?: string; page?: number; size?: number }): Promise<{ content: AgentExecutionLog[]; totalElements: number; totalPages: number }> {
    const searchParams = new URLSearchParams();
    if (params?.agentCode) searchParams.set('agentCode', params.agentCode);
    if (params?.page !== undefined) searchParams.set('page', String(params.page));
    if (params?.size !== undefined) searchParams.set('size', String(params.size));
    return (await request<{ content: AgentExecutionLog[]; totalElements: number; totalPages: number }>(`/agents/executions?${searchParams}`)) || { content: [], totalElements: 0, totalPages: 0 };
  },

  async getRecentExecutions(limit?: number): Promise<AgentExecution[]> {
    return (await request<AgentExecution[]>(`/agents/executions/recent?limit=${limit || 20}`)) || [];
  },

  /** 获取当前正在执行（RUNNING）的执行记录 */
  async getRunningExecutions(): Promise<AgentExecutionLog[]> {
    return (await request<AgentExecutionLog[]>('/agents/executions/running')) || [];
  },

  async getStats(): Promise<AgentStats[]> {
    return (await request<AgentStats[]>('/agents/stats')) || [];
  },

  async getSyncBridgeStatus(): Promise<{ activeWaiting: number; waitingTaskIds: number[] }> {
    return (await request<{ activeWaiting: number; waitingTaskIds: number[] }>('/n8n/agents/sync-bridge/status'))
        || { activeWaiting: 0, waitingTaskIds: [] };
  },

  getCapabilityHealth: (capability: string) =>
    request<any>(`/n8n/capabilities/${capability}/health`),

  getAllCapabilitiesHealth: () =>
    request<any[]>(`/n8n/capabilities/health`),

  getCircuitBreakerStatus: () =>
    request<Record<string, any>>(`/n8n/agents/circuit-breaker/status`),

  resetCircuitBreaker: (capability: string) =>
    request<string>(`/n8n/agents/circuit-breaker/${capability}/reset`, { method: 'POST' }),

  getRouteStatistics: () =>
    request<Record<string, any>>(`/n8n/capabilities/route-stats`),

  getExecutionStats: () =>
    request<AgentStats[]>(`/n8n/agent/executions/stats`),

  /** 获取指定 Agent 的所有实例 */
  getInstancesByAgent: (agentCode: string): Promise<AgentInstance[]> =>
    request<AgentInstance[]>(`/agents/${encodeURIComponent(agentCode)}/instances`).then(r => r || []),

  /** 获取所有 Agent 实例（需要 ai:manage 权限） */
  getAllInstances: (): Promise<AgentInstance[]> =>
    request<AgentInstance[]>('/agents/instances').then(r => r || []),

  /** 下载服务端 Agent 执行记录 CSV */
  async exportExecutionsCsv(params?: { agentCode?: string; status?: string; days?: number }): Promise<Blob> {
    const searchParams = new URLSearchParams();
    if (params?.agentCode) searchParams.set('agentCode', params.agentCode);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.days !== undefined) searchParams.set('days', String(params.days));
    const url = `${getApiBaseUrl()}/agents/executions/export/csv?${searchParams}`;
    const token = getAuthToken();
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token || ''}` },
    });
    if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
    return resp.blob();
  },

  /** 下载服务端 Agent 执行记录 JSON */
  async exportExecutionsJson(params?: { agentCode?: string; status?: string; days?: number }): Promise<Blob> {
    const searchParams = new URLSearchParams();
    if (params?.agentCode) searchParams.set('agentCode', params.agentCode);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.days !== undefined) searchParams.set('days', String(params.days));
    const url = `${getApiBaseUrl()}/agents/executions/export/json?${searchParams}`;
    const token = getAuthToken();
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token || ''}` },
    });
    if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
    return resp.blob();
  },
};
