/**
 * 任务调度 API
 */
import type {
  TaskDefinition,
  TaskInstance,
  TaskCompleteRequest,
  PaginatedResponse,
} from '../../types/server';
import { request } from './client';

export const taskApi = {
  /** 获取仪表盘统计 */
  async getDashboard(): Promise<Record<string, Record<string, number>>> {
    return request<Record<string, Record<string, number>>>('/task-admin/dashboard');
  },

  /** 获取任务定义列表 */
  async getDefinitions(): Promise<TaskDefinition[]> {
    return request<TaskDefinition[]>('/task-admin/definitions');
  },

  /** 切换任务定义启用/禁用 */
  async toggleDefinition(id: number): Promise<TaskDefinition> {
    return request<TaskDefinition>(`/task-admin/definitions/${id}/toggle`, {
      method: 'PUT',
    });
  },

  /** 手动触发任务 */
  async triggerTask(code: string): Promise<TaskInstance> {
    return request<TaskInstance>(`/task-admin/definitions/${code}/trigger`, {
      method: 'POST',
    });
  },

  /** 获取执行历史 */
  async getHistory(params: { type?: string; page?: number; size?: number } = {}): Promise<PaginatedResponse<TaskInstance>> {
    const searchParams = new URLSearchParams();
    if (params.type) searchParams.append('type', params.type);
    if (params.page !== undefined) searchParams.append('page', String(params.page));
    if (params.size !== undefined) searchParams.append('size', String(params.size));
    const query = searchParams.toString();
    return request<PaginatedResponse<TaskInstance>>(`/task-admin/history${query ? `?${query}` : ''}`);
  },

  /** 客户端认领任务 */
  async claimTasks(type: string, clientId: string, limit = 1): Promise<TaskInstance[]> {
    return request<TaskInstance[]>(`/tasks/claim?type=${encodeURIComponent(type)}&clientId=${encodeURIComponent(clientId)}&limit=${limit}`, {
      method: 'POST',
    });
  },

  /** 完成任务 */
  async completeTask(id: number, data: TaskCompleteRequest): Promise<void> {
    await request<void>(`/tasks/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /** 释放任务 */
  async releaseTask(id: number, clientId: string): Promise<void> {
    await request<void>(`/tasks/${id}/release?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST',
    });
  },

  /** 获取我的任务 */
  async getMyTasks(clientId: string): Promise<TaskInstance[]> {
    return request<TaskInstance[]>(`/tasks/mine?clientId=${encodeURIComponent(clientId)}`);
  },
};
