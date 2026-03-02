/**
 * AI 工作流 API
 *
 * 管理 AI 工作流的 CRUD、版本、部署、工作区和 AI 对话。
 */
import { request } from './client';

// ====== 类型定义 ======

export interface AiWorkflow {
  id: number;
  name: string;
  description: string;
  n8nWorkflowId: string | null;
  currentJson: string | null;
  currentVersion: number;
  status: string; // DRAFT | DEPLOYED | ACTIVE | INACTIVE
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiWorkflowVersion {
  id: number;
  workflowId: number;
  versionNumber: number;
  workflowJson: string;
  changeDescription: string;
  createdBy: string;
  createdAt: string;
}

export interface AiWorkflowWorkspaceDoc {
  id: number;
  workflowId: number;
  docType: string; // SWAGGER_GROUP | CUSTOM
  docTitle: string;
  swaggerGroup: string | null;
  docContent: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowChatRequest {
  userMessage: string;
  conversationHistory: Array<{ role: string; content: string }>;
  agentCode?: string;
}

export interface WorkflowChatResponse {
  output: string;
  success: boolean;
  errorMessage?: string;
}

/** AI 设计师返回的结构化结果 */
export interface WorkflowDesignResult {
  explanation: string;
  workflowJson: Record<string, unknown> | null;
  agentPromptAdjustments: AgentPromptAdjustment[];
  apiAdjustments: ApiAdjustment[];
}

export interface AgentPromptAdjustment {
  agentCode: string;
  agentName: string;
  reason: string;
  suggestedPrompt: string;
}

export interface ApiAdjustment {
  endpoint: string;
  method: string;
  description: string;
  suggestedChanges: string;
}

// ====== API ======

export const workflowAiApi = {
  // CRUD
  list: () => request<AiWorkflow[]>('/ai-workflows'),

  create: (data: { name: string; description?: string }) =>
    request<AiWorkflow>('/ai-workflows', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getById: (id: number) => request<AiWorkflow>(`/ai-workflows/${id}`),

  updateJson: (id: number, data: { json: string; changeDescription?: string }) =>
    request<AiWorkflow>(`/ai-workflows/${id}/json`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    request<void>(`/ai-workflows/${id}`, { method: 'DELETE' }),

  // 版本管理
  getVersions: (id: number) =>
    request<AiWorkflowVersion[]>(`/ai-workflows/${id}/versions`),

  rollback: (id: number, data: { versionNumber: number }) =>
    request<AiWorkflow>(`/ai-workflows/${id}/rollback`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // 校验 + 部署
  validate: (id: number) =>
    request<void>(`/ai-workflows/${id}/validate`, { method: 'POST' }),

  deploy: (id: number) =>
    request<AiWorkflow>(`/ai-workflows/${id}/deploy`, { method: 'POST' }),

  activate: (id: number) =>
    request<AiWorkflow>(`/ai-workflows/${id}/activate`, { method: 'POST' }),

  deactivate: (id: number) =>
    request<AiWorkflow>(`/ai-workflows/${id}/deactivate`, { method: 'POST' }),

  // 工作区
  getWorkspace: (id: number) =>
    request<AiWorkflowWorkspaceDoc[]>(`/ai-workflows/${id}/workspace`),

  addWorkspaceDoc: (
    id: number,
    data: {
      docType: string;
      docTitle: string;
      swaggerGroup?: string;
      docContent?: string;
      sortOrder?: number;
    },
  ) =>
    request<AiWorkflowWorkspaceDoc>(`/ai-workflows/${id}/workspace`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  removeWorkspaceDoc: (id: number, docId: number) =>
    request<void>(`/ai-workflows/${id}/workspace/${docId}`, {
      method: 'DELETE',
    }),

  getSwaggerGroups: () => request<string[]>('/ai-workflows/swagger-groups'),

  previewSwaggerDoc: (group: string) =>
    request<string>(`/ai-workflows/swagger-preview/${encodeURIComponent(group)}`),

  assembleContext: (id: number) =>
    request<string>(`/ai-workflows/${id}/workspace/assemble`, {
      method: 'POST',
    }),

  // AI 对话
  chat: (id: number, data: WorkflowChatRequest) =>
    request<WorkflowChatResponse>(`/ai-workflows/${id}/chat`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
