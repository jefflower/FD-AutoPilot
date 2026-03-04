/**
 * 兼容桥接文件
 *
 * 原有的 serverApi 已拆分到 ./api/ 目录。
 * 此文件 re-export 所有公共 API 以保持外部 import 路径不变。
 */
export {
  // Client utilities
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
  // API objects
  authApi,
  ticketApi,
  auditTokenApi,
  downloadWithAuth,
  agentApi,
  taskApi,
  adminApi,
  rbacApi,
  actuatorApi,
  configApi,
  userSettingsApi,
  orgSyncApi,
  oauthApi,
  capabilityApi,
  clientApi,
  knowledgeApi,
  notebookLmBridge,
  workflowAiApi,
  // Aggregated serverApi
  serverApi,
} from './api';

export { serverApi as default } from './api';
