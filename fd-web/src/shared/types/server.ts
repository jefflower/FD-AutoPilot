/**
 * 服务端类型定义
 * 对应 system-design.md 中的数据结构
 */

// ============ 用户相关 ============
export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'AUDITOR';
export type UserStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type UserType = 'INTERNAL' | 'EXTERNAL';

export interface User {
  id: number;
  username: string;
  role: UserRole;       // 保留兼容（= roles[0]）
  roles?: UserRole[];   // 完整角色列表
  userType?: UserType;  // B端(INTERNAL) / C端(EXTERNAL)
  status: UserStatus;
  createdAt: string;
  displayName?: string;
  avatar?: string;
  mobile?: string;
  email?: string;
  departmentId?: number;
  dingtalkUserId?: string;
  wecomUserId?: string;
  externalSyncAt?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;                    // 兼容旧代码（= accessToken）
  accessToken: string;              // 新增
  refreshToken: string;             // 新增
  expireAt: number;                 // 兼容旧代码（= accessTokenExpireAt）
  accessTokenExpireAt: number;      // 新增
  refreshTokenExpireAt: number;     // 新增
  user: User;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

// ============ 应用相关 ============
export interface SysApplication {
  id: number;
  code: string;
  name: string;
  description?: string;
  enabled: boolean;
  builtIn: boolean;
  createdAt: string;
}

// ============ RBAC 相关 ============
export interface SysRole {
  id: number;
  code: string;
  name: string;
  description?: string;
  builtIn: boolean;
  createdAt: string;
}

export interface SysPermission {
  id: number;
  code: string;
  name: string;
  module: string;
  description?: string;
  type?: 'ROUTE' | 'OPERATION' | 'DATA';
  builtIn?: boolean;
  createdAt: string;
}

export interface SysModule {
  id: number;
  code: string;
  name: string;
  description?: string;
  icon?: string;
  sortOrder: number;
  enabled: boolean;
  routePath?: string;
  builtIn: boolean;
  createdAt: string;
}

export interface PermissionOverview {
  modules: SysModule[];
  permissions: SysPermission[];
  roles: SysRole[];
  matrix: Record<string, string[]>;  // roleCode → permissionCodes
  stats: {
    moduleCount: number;
    permissionCount: number;
    roleCount: number;
  };
}

// ============ 工单相关 ============
export type TicketStatus =
  | 'PENDING_TRANS'
  | 'TRANSLATING'
  | 'PENDING_REPLY'
  | 'REPLYING'
  | 'PROCESSING'
  | 'PENDING_AUDIT'
  | 'AUDITING'
  | 'APPROVED'
  | 'MANUAL_REQUIRED'
  | 'COMPLETED';

export type TicketCategory = 'PRODUCT_FAULT' | 'LOGISTICS_INQUIRY' | 'BUSINESS_COOPERATION' | 'OTHER';

export interface ServerTicket {
  id: number;
  externalId: string;
  subject: string;
  content: string;
  sourceLang: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  isValid: boolean;
  lastAuditRemark?: string;
  /** 工单来源（FRESHDESK / MANUAL 等） */
  origin?: string;
  /** Freshdesk 原始工单状态 */
  fdStatus?: number;
  /** Freshdesk 原始工单优先级 */
  fdPriority?: number;
  /** AI 分类类别 */
  ticketCategory?: string;
  /** 列表 DTO 返回的翻译标题（轻量，仅列表查询时存在） */
  translatedTitle?: string;
  translation?: TicketTranslation;
  replies?: TicketReply[];
}

export interface TicketTranslation {
  id: number;
  ticketId: number;
  targetLang: string;
  translatedTitle: string;
  translatedContent: string;
  createdAt: string;
}

export interface TicketReply {
  id: number;
  ticketId: number;
  replyLang: string;
  zhReply: string;
  targetReply: string;
  isSelected: boolean;
  createdAt: string;
}

export interface TicketAudit {
  id: number;
  ticketId: number;
  replyId: number;
  auditResult: 'PASS' | 'REJECT';
  auditRemark: string;
  auditorId: number;
  createdAt: string;
}

// ============ API 请求/响应类型 ============
export interface TicketQueryParams {
  status?: string;  // 逗号分隔多选，如 "PENDING_TRANS,TRANSLATING"
  externalId?: string;
  subject?: string;
  isValid?: boolean;
  createdAfter?: string;
  createdBefore?: string;
  fdStatus?: string; // 逗号分隔多选，如 "2,3"
  page?: number;
  size?: number;
}

export interface UserQueryParams {
  status?: UserStatus;
  username?: string;
  page?: number;
  size?: number;
}

export interface PaginatedResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

export type PaginatedTickets = PaginatedResponse<ServerTicket>;
export type PaginatedUsers = PaginatedResponse<User>;

export interface TranslationSubmitData {
  targetLang: string;
  translatedTitle: string;
  translatedContent: string;
}

export interface ReplySubmitData {
  zhReply: string;
  targetReply: string;
}

export interface AuditSubmitData {
  replyId: number;
  auditResult: 'PASS' | 'REJECT' | 'RETRANSLATE';
  auditRemark?: string;
}

export interface ValidityUpdateData {
  isValid: boolean;
}

export interface SyncResult {
  syncedCount: number;
  updatedCount?: number;
  success: boolean;
  message: string;
}

// ============ 同步配置相关 ============
export interface SyncConfig {
  cronExpression: string;
  syncEnabled: boolean;
  lastSyncTime: string | null;
  isSyncing: boolean;
}

export interface SyncConfigUpdate {
  cronExpression?: string;
  syncEnabled?: string;
  lastSyncTime?: string;
}

export interface SyncStatus {
  isSyncing: boolean;
  lastSyncTime: string | null;
}

export interface SyncLog {
  id: number;
  startTime: string;
  endTime: string | null;
  ticketsSynced: number;
  ticketsUpdated: number;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  triggerType: 'MANUAL' | 'SCHEDULED';
  errorMessage: string | null;
}

export type PaginatedSyncLogs = PaginatedResponse<SyncLog>;

export interface ApiError {
  error: string;
  message: string;
}

// ============ 知识库相关 ============
export interface KnowledgeNote {
  id: number;
  title: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt?: string;
}

export interface KnowledgeNoteRequest {
  title: string;
  content: string;
  sortOrder?: number;
}

// ============ 任务队列计数 ============
export interface QueueCounts {
  translation: number;
  reply: number;
  audit: number;
}

// ============ 数据库查询相关 ============
export interface SqlQueryResult {
  success: boolean;
  error?: string;
  columns?: SqlColumnInfo[];
  rows?: (string | number | boolean | null)[][];
  rowCount?: number;
  updateCount?: number;
  destructive?: boolean;
  executionTimeMs: number;
}

export interface SqlColumnInfo {
  name: string;
  type: string;
}

export interface TableInfo {
  tableName: string;
  columns: TableColumnDetail[];
}

export interface TableColumnDetail {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

// Client settings (stored on server via UserAppSettings API)
export interface ClientSettings {
  translationLang: string;
}

export interface NotebookLMConfig {
  notebookId: string;
  notebookUrl?: string;
  prompt: string;
}

// AI Translation Engine config (stored via UserAppSettings, appCode: 'ai-translation-config')
export interface AiTranslationConfig {
  provider: 'gemini-cli' | 'gemini-api' | string;
  geminiCliPath?: string;
  geminiModel?: string;
  apiKey?: string;
  apiEndpoint?: string;
}

// ============ 任务调度相关 ============
export interface TaskDefinition {
  id: number;
  code: string;
  name: string;
  description?: string;
  executionMode: 'CLIENT_DISTRIBUTED' | 'SERVER_SCHEDULED' | 'SERVER_TRIGGERED';
  cronExpression?: string;
  timeoutSeconds: number;
  maxRetries: number;
  maxConcurrency: number;
  enabled: boolean;
  handlerName?: string;
  config?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInstance {
  id: number;
  taskType: string;
  referenceType?: string;
  referenceId?: string;
  status: 'PENDING' | 'CLAIMED' | 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'CANCELLED';
  triggerType: 'EVENT' | 'SCHEDULED' | 'MANUAL';
  assignedTo?: string;
  assignedAt?: string;
  payload?: string;
  result?: string;
  errorMessage?: string;
  retryCount: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskCompleteRequest {
  clientId: string;
  success: boolean;
  message?: string;
}

// ============ 移动审核相关 ============
export interface MobileAuditDetail {
  ticketId: number;
  externalId: string;
  subject: string;
  content: string;
  translatedTitle?: string;
  translatedContent?: string;
  zhReply?: string;
  targetReply?: string;
  replyId?: number;
  status: string;
  lastAuditRemark?: string;
  auditHistory: AuditHistoryItem[];
  alreadyAudited: boolean;
}

export interface AuditHistoryItem {
  auditResult: string;
  auditRemark?: string;
  createdAt: string;
}

export interface MobileAuditSubmit {
  auditResult: 'PASS' | 'REJECT';
  auditRemark?: string;
}

export interface MobileAuditResult {
  success: boolean;
  message: string;
  auditResult?: string;
}

// ============ 通知渠道配置 ============
export interface NotifyChannelConfig {
  platform: string;
  webhookUrl: string;
  enabled: boolean;
  auditBaseUrl: string;
}

// ============ 组织架构同步 ============
export interface OrgSyncConfig {
  orgSyncPlatform: string;
  oauthEnabled: boolean;
  defaultSyncRole: string;
  dingtalkAppKey: string;
  dingtalkAppSecret: string;
  dingtalkCorpId: string;
  dingtalkRootDeptId: string;
  wecomCorpId: string;
  wecomAgentId: string;
  wecomSecret: string;
  wecomRootDeptId: string;
}

export interface OrgSyncResult {
  departmentsCreated: number;
  departmentsUpdated: number;
  usersCreated: number;
  usersUpdated: number;
  usersSkipped: number;
  platform: string;
  durationMs: number;
}

export interface OrgSyncLog {
  id: number;
  platform: string;
  triggerUser: string;
  startTime: string;
  endTime: string | null;
  departmentsCreated: number;
  departmentsUpdated: number;
  usersCreated: number;
  usersUpdated: number;
  usersSkipped: number;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  errorMessage: string | null;
  createdAt: string;
}

export interface SysDepartment {
  id: number;
  name: string;
  parentId: number | null;
  externalId: string;
  platform: string;
  sortOrder: number;
  path: string;
}

export interface OAuthStatus {
  enabled: boolean;
  platform: string;
}

// ============ AI Agent ============
export type AgentProviderType = 'GEMINI_CLI' | 'CLAUDE_CLI' | 'HTTP_API' | 'NOTEBOOKLM' | 'NOTEBOOKLM_PY' | 'TRACKING_SHADOW' | 'LOCAL_FUNCTION'
    | 'WEB_AUTOMATION' | 'SHADOW_WINDOW' | 'LOCAL_CLI'; // deprecated 兼容旧值
export type AgentExecutionEnv = 'CLIENT_ONLY' | 'SERVER_ONLY' | 'BOTH';
export type AgentExecutionStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'CANCELLED';

export interface AgentDefinition {
  id: number;
  code: string;
  name: string;
  description: string;
  providerType: AgentProviderType | null;
  executionEnv: AgentExecutionEnv;
  capability: string;
  requiredCapability?: string;
  groupCode?: string;
  systemPrompt?: string;
  agentConfig: string | Record<string, any>;
  enabled: boolean;
  autoStart?: boolean;
  sortOrder: number;
  builtIn: boolean;
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
}

export interface CapabilityDefinition {
  id: number;
  code: string;
  name: string;
  description?: string;
  providerType: AgentProviderType;
  configSchema?: string;
  detectConfig?: string;
  installGuide?: string;
  enabled: boolean;
  builtIn: boolean;
  sortOrder: number;
  executionEnv: AgentExecutionEnv;
  createdAt: string;
  updatedAt?: string;
}

export interface AgentExecuteInput {
  data: any;
  params?: Record<string, any>;
  referenceType?: string;
  referenceId?: number;
}

export interface AgentExecuteResult {
  success: boolean;
  output: any;
  durationMs: number;
  tokenCount?: number;
  error?: string;
}

export interface AgentStreamChunk {
  text: string;
  status: 'streaming' | 'complete' | 'error';
  parsedOutput?: Record<string, any>;  // 仅 status='complete' 时存在
}

/** 标准化的 Agent 输入，由 inputSchema 定义结构 */
export interface StandardAgentInput {
  ticket?: {
    id: number;
    subject: string;
    content: string;
  };
  targetLang?: string;
  lastAuditRemark?: string;
  trackingNumbers?: string[];
  [key: string]: any;
}

export interface AgentProxyTestResult {
  reachable: boolean;
  models: string[];
  errorMessage?: string;
}

export interface AgentExecutionReport {
  agentCode: string;
  status: AgentExecutionStatus;
  durationMs: number;
  tokenCount?: number;
  referenceType?: string;
  referenceId?: number;
  executedOn: string;
  inputSnapshot?: string;
  outputSnapshot?: string;
  errorMessage?: string;
}

export interface AgentStats {
  agentCode: string;
  agentName: string;
  totalExecutions: number;
  successCount: number;
  failedCount: number;
  avgDurationMs: number;
  successRate: number;
}

export interface AgentExecutionLog {
  id: number;
  agentCode: string;
  status: AgentExecutionStatus;
  referenceType?: string;
  referenceId?: number;
  executedBy?: string;
  executedOn?: string;
  durationMs?: number;
  tokenCount?: number;
  inputSnapshot?: string;
  outputSnapshot?: string;
  errorMessage?: string;
  createdAt: string;
}

/** 最近执行记录（用于仪表盘时间线） */
export interface AgentExecution {
  id: number;
  agentCode: string;
  capability?: string;
  status: AgentExecutionStatus;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  input?: string;
  output?: string;
  errorMessage?: string;
  createdAt: string;
}

export type AgentBindings = Record<string, string>;

// ============ Agent Instance & Client Registration ============
export interface AgentInstance {
  id: number;
  clientId: string;
  userId: string;
  agentCode: string;
  localConfig?: string;
  running: boolean;
  lastHeartbeat?: string;
  version?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ClientRegistration {
  clientId: string;
  userId: string;
  clientType: string;
  version: string;
  enabledCapabilities: string;
  detectedSkills?: string;
  lastHeartbeat?: string;
  online: boolean;
  createdAt: string;
}

export interface ClientSkillItem {
  name: string;
  description: string;
  command?: string;
}

export interface ClientRegisterRequest {
  clientId: string;
  clientType: 'TAURI' | 'WEB' | 'BRIDGE';
  version: string;
  enabledCapabilities: string[];
  runningAgents: string[];
  detectedSkills?: Record<string, ClientSkillItem[]>;
}

export interface ClientRegisterResponse {
  clientId: string;
  instanceCount: number;
  onlineClients: number;
}

export interface ClientHeartbeatRequest {
  clientId: string;
  runningAgents: string[];
}

export interface ClientHeartbeatResponse {
  serverTime: string;
  commands: unknown[];
}

// ============ 知识库管理 ============
export type KnowledgeSourceType = 'PDF' | 'URL' | 'TEXT' | 'CSV' | 'MARKDOWN';
export type KnowledgeBaseSyncStatus = 'NOT_SYNCED' | 'SYNCING' | 'SYNCED' | 'FAILED';
export type KnowledgeVisibility = 'PUBLIC' | 'PRIVATE';
export type KnowledgePermissionLevel = 'READ' | 'WRITE' | 'ADMIN';
export type KnowledgePermissionTarget = 'GROUP' | 'BASE';

export interface KnowledgeGroup {
  id: number;
  name: string;
  description?: string;
  color?: string;
  visibility: KnowledgeVisibility;
  createdBy?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface KnowledgeBase {
  id: number;
  name: string;
  description?: string;
  notebookId?: string;
  color?: string;
  groupId?: number;
  visibility?: KnowledgeVisibility;
  createdBy?: number;
  sourceCount?: number;
  syncedCount?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface KnowledgeSource {
  id: number;
  knowledgeBaseId: number;
  title: string;
  sourceType: KnowledgeSourceType;
  content?: string;
  filePath?: string;
  originalFileName?: string;
  url?: string;
  fileSize?: number;
  syncStatus: KnowledgeBaseSyncStatus;
  notebookSourceId?: string;
  syncedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface KnowledgeSyncConfig {
  knowledgeBaseId?: number;
  ticketSourceId?: number;
  notesSourceId?: number;
}

export interface KnowledgePermission {
  id: number;
  targetType: KnowledgePermissionTarget;
  targetId: number;
  userId: number;
  permission: KnowledgePermissionLevel;
  createdAt: string;
}

export interface NotebookInfo {
  id: string;
  title: string;
  isOwner: boolean;
  createdAt: string;
}

/** Bridge 返回的远程源信息 */
export interface RemoteSource {
  id: string;
  title: string;
  status: string;
  type?: string;
}

// ============ 用户 Agent 配置 ============
/** 用户 Agent 配置（来自 /api/v1/user-agents） */
export interface UserAgentConfigDTO {
    agentCode: string;
    autoStart: boolean;
    enabled: boolean;
    subscribedAt: string;
    // AgentDefinition 摘要
    agentName: string;
    description: string;
    capability: string;
    requiredCapability: string;
    executionEnv: string;
    groupCode: string;
    agentEnabled: boolean;  // 全局启用状态
}

/** 用户 Agent 订阅请求 */
export interface UserAgentSubscribeRequest {
    agentCode: string;
}

/** 用户 Agent 配置更新请求 */
export interface UserAgentConfigUpdateRequest {
    autoStart?: boolean;
    enabled?: boolean;
}
