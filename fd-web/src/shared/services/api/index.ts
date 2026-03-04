/**
 * API 模块入口
 *
 * re-export 所有 API 对象和工具函数，保持外部 import 路径兼容。
 */

// Client: HTTP 客户端、Token 管理
export {
  ApiError,
  request,
  getApiBaseUrl,
  getActuatorBaseUrl,
  setServerBaseUrl,
  getServerBaseUrl,
  setAuthToken,
  getAuthToken,
  setRefreshToken,
  getRefreshToken,
  isTokenExpired,
  checkServerConnection,
  isNetworkError,
} from './client';

// Auth API
export { authApi } from './auth';

// Ticket API
export { ticketApi, auditTokenApi, downloadWithAuth } from './ticket';

// Agent API
export { agentApi } from './agent';

// Task API
export { taskApi } from './task';

// System APIs (admin, rbac, actuator, config, userSettings, orgSync, oauth)
export {
  adminApi,
  rbacApi,
  actuatorApi,
  configApi,
  userSettingsApi,
  orgSyncApi,
  oauthApi,
} from './system';

// Capability / Client APIs
export { capabilityApi, clientApi } from './capability';

// Knowledge API
export { knowledgeApi, notebookLmBridge } from './knowledge';

// Workflow AI API
export { workflowAiApi } from './workflow';
export type {
  AiWorkflow,
  AiWorkflowVersion,
  AiWorkflowWorkspaceDoc,
  WorkflowChatRequest,
  WorkflowChatResponse,
  WorkflowDesignResult,
  AgentPromptAdjustment,
  ApiAdjustment,
} from './workflow';

// 聚合 serverApi 对象（保持与旧接口完全兼容）
import { authApi } from './auth';
import { ticketApi } from './ticket';
import { agentApi } from './agent';
import { taskApi } from './task';
import { adminApi, rbacApi, actuatorApi, configApi, userSettingsApi, orgSyncApi, oauthApi } from './system';
import { capabilityApi, clientApi } from './capability';
import { knowledgeApi } from './knowledge';
import { workflowAiApi } from './workflow';

export const serverApi = {
  auth: authApi,
  ticket: ticketApi,
  admin: adminApi,
  rbac: rbacApi,
  actuator: actuatorApi,
  config: configApi,
  task: taskApi,
  userSettings: userSettingsApi,
  orgSync: orgSyncApi,
  oauth: oauthApi,
  agent: agentApi,
  capability: capabilityApi,
  client: clientApi,
  knowledge: knowledgeApi,
  workflowAi: workflowAiApi,
};

export default serverApi;
