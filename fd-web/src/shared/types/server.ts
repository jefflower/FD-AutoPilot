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
  | 'PENDING_AUDIT'
  | 'AUDITING'
  | 'APPROVED'
  | 'COMPLETED';

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
  status?: TicketStatus;
  externalId?: string;
  subject?: string;
  isValid?: boolean;
  createdAfter?: string;
  createdBefore?: string;
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
  auditResult: 'PASS' | 'REJECT';
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
  notebookLMConfig: NotebookLMConfig;
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

