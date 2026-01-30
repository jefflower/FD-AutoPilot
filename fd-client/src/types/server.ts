/**
 * 服务端类型定义
 * 对应 system-design.md 中的数据结构
 */

// ============ 用户相关 ============
export type UserRole = 'ADMIN' | 'USER';
export type UserStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expireAt: number;
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

