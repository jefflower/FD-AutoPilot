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

const TICKET_STATUS_COLORS: Record<string, string> = {
  '': 'bg-slate-500',
  PENDING_TRANS: 'bg-yellow-500/20 text-yellow-500',
  TRANSLATING: 'bg-blue-500/20 text-blue-500',
  PENDING_REPLY: 'bg-orange-500/20 text-orange-500',
  REPLYING: 'bg-purple-500/20 text-purple-500',
  PENDING_AUDIT: 'bg-pink-500/20 text-pink-500',
  AUDITING: 'bg-indigo-500/20 text-indigo-400',
  APPROVED: 'bg-emerald-500/20 text-emerald-500',
  COMPLETED: 'bg-green-500/20 text-green-500',
};

const TICKET_STATUSES = [
  'PENDING_TRANS', 'TRANSLATING', 'PENDING_REPLY', 'REPLYING',
  'PENDING_AUDIT', 'AUDITING', 'APPROVED', 'COMPLETED',
] as const;

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
