/**
 * 服务端类型定义
 * 对应 system-design.md 中的数据结构
 */

// ============ 用户相关 ============
export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'AUDITOR';
export type UserStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface User {
  id: number;
  username: string;
  role: UserRole;       // 保留兼容（= roles[0]）
  roles?: UserRole[];   // 新增：完整角色列表
  status: UserStatus;
  createdAt: string;
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

// ============ MQ 队列计数 ============
export interface QueueCounts {
  translation: number;
  reply: number;
  audit: number;
  dlq: number;
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

