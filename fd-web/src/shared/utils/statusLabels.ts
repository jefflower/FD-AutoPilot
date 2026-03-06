// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTFunction = (...args: any[]) => string;

export function getTicketStatusLabel(t: AnyTFunction, status: string): string {
  return t(`ticketStatus.${status}`, { ns: 'common', defaultValue: status });
}

export function getUserStatusLabel(t: AnyTFunction, status: string): string {
  return t(`userStatus.${status}`, { ns: 'common', defaultValue: status });
}

export function getUserRoleLabel(t: AnyTFunction, role: string): string {
  return t(`userRole.${role}`, { ns: 'common', defaultValue: role });
}

export const TICKET_STATUS_COLORS: Record<string, string> = {
  '': 'bg-slate-500',
  PENDING_TRANS: 'bg-yellow-500/20 text-yellow-500',
  TRANSLATING: 'bg-blue-500/20 text-blue-500',
  PENDING_REPLY: 'bg-orange-500/20 text-orange-500',
  REPLYING: 'bg-cyan-500/20 text-cyan-500',
  PROCESSING: 'bg-indigo-500/20 text-indigo-500',
  PENDING_AUDIT: 'bg-pink-500/20 text-pink-500',
  AUDITING: 'bg-purple-500/20 text-purple-500',
  APPROVED: 'bg-emerald-500/20 text-emerald-500',
  MANUAL_REQUIRED: 'bg-red-500/20 text-red-500',
  COMPLETED: 'bg-green-500/20 text-green-500',
};

const TICKET_STATUSES = [
  'PENDING_TRANS', 'TRANSLATING', 'PENDING_REPLY', 'REPLYING',
  'PROCESSING', 'PENDING_AUDIT', 'AUDITING', 'APPROVED', 'MANUAL_REQUIRED', 'COMPLETED',
] as const;

// ============ Freshdesk 工单状态映射 ============

/** Freshdesk 状态数字到标签的映射 */
const FD_STATUS_LABELS: Record<number, string> = {
  2: 'Open',
  3: 'Pending',
  4: 'Resolved',
  5: 'Closed',
  6: 'Waiting on Customer',
  7: 'Waiting on Third Party',
};

/** Freshdesk 状态对应的 Tailwind 颜色样式 */
export const FD_STATUS_COLORS: Record<number, string> = {
  2: 'bg-blue-500/20 text-blue-400 ring-blue-500/30',        // Open - 蓝色
  3: 'bg-yellow-500/20 text-yellow-400 ring-yellow-500/30',   // Pending - 黄色
  4: 'bg-green-500/20 text-green-400 ring-green-500/30',      // Resolved - 绿色
  5: 'bg-slate-500/20 text-slate-400 ring-slate-500/30',      // Closed - 灰色
  6: 'bg-orange-500/20 text-orange-400 ring-orange-500/30',   // Waiting on Customer - 橙色
  7: 'bg-violet-500/20 text-violet-400 ring-violet-500/30',   // Waiting on Third Party - 紫色
};

/** 获取 Freshdesk 状态标签文本 */
export function getFdStatusLabel(fdStatus: number): string {
  return FD_STATUS_LABELS[fdStatus] || `Status ${fdStatus}`;
}

/** 获取 Freshdesk 状态对应的颜色样式 */
export function getFdStatusColor(fdStatus: number): string {
  return FD_STATUS_COLORS[fdStatus] || 'bg-slate-500/20 text-slate-400 ring-slate-500/30';
}

// ============ 工单分类映射 ============

export const TICKET_CATEGORY_LABELS: Record<string, string> = {
  PRODUCT_FAULT: '产品故障',
  LOGISTICS_INQUIRY: '物流查询',
  BUSINESS_COOPERATION: '商务合作',
  VIDEO_REVIEW: '视频审查',
  OTHER: '其他',
};

export const TICKET_CATEGORY_COLORS: Record<string, string> = {
  PRODUCT_FAULT: 'bg-red-500/20 text-red-400 ring-red-500/30',
  LOGISTICS_INQUIRY: 'bg-blue-500/20 text-blue-400 ring-blue-500/30',
  BUSINESS_COOPERATION: 'bg-amber-500/20 text-amber-400 ring-amber-500/30',
  VIDEO_REVIEW: 'bg-purple-500/20 text-purple-400 ring-purple-500/30',
  OTHER: 'bg-slate-500/20 text-slate-400 ring-slate-500/30',
};

export function getTicketCategoryLabel(category: string): string {
  return TICKET_CATEGORY_LABELS[category] || category;
}

export function getTicketCategoryColor(category: string): string {
  return TICKET_CATEGORY_COLORS[category] || 'bg-slate-500/20 text-slate-400 ring-slate-500/30';
}

export function getTicketStatusOptions(t: AnyTFunction) {
  return [
    { value: '', label: t('label.allStatus', { ns: 'common' }), color: TICKET_STATUS_COLORS[''] },
    ...TICKET_STATUSES.map(status => ({
      value: status,
      label: t(`ticketStatus.${status}`, { ns: 'common' }),
      color: TICKET_STATUS_COLORS[status],
    })),
  ];
}

const FD_STATUSES = [2, 3, 4, 5, 6, 7] as const;

export function getFdStatusOptions() {
  return [
    { value: 0, label: '全部FD', color: 'bg-slate-500/20 text-slate-400 ring-slate-500/30' },
    ...FD_STATUSES.map(fd => ({
      value: fd,
      label: FD_STATUS_LABELS[fd] || `Status ${fd}`,
      color: FD_STATUS_COLORS[fd] || 'bg-slate-500/20 text-slate-400 ring-slate-500/30',
    })),
  ];
}
