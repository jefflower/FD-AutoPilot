export interface RouteConfig {
  path: string;
  label: string;
  icon: string;
  module: string;
  requiredPermission?: string;
  requiresTauri?: boolean;
}

export const routes: RouteConfig[] = [
  // Ticket 模块
  { path: '/tickets', label: '工单列表', icon: 'list', module: 'ticket', requiredPermission: 'ticket:read' },
  { path: '/translation', label: '翻译任务', icon: 'languages', module: 'ticket', requiredPermission: 'ticket:translate', requiresTauri: true },
  { path: '/reply', label: '回复任务', icon: 'message-square', module: 'ticket', requiredPermission: 'ticket:reply', requiresTauri: true },
  { path: '/audit', label: '审核任务', icon: 'check-circle', module: 'ticket', requiredPermission: 'ticket:audit', requiresTauri: true },
  { path: '/approved', label: '待推送', icon: 'send', module: 'ticket', requiredPermission: 'ticket:push' },

  // Admin 模块
  { path: '/admin/users', label: '用户管理', icon: 'users', module: 'auth', requiredPermission: 'user:read' },
  { path: '/admin/sync', label: '同步管理', icon: 'refresh-cw', module: 'system', requiredPermission: 'sync:manage' },
  { path: '/admin/knowledge', label: '知识库', icon: 'book-open', module: 'system', requiredPermission: 'knowledge:read' },
  { path: '/admin/database', label: '数据库', icon: 'database', module: 'system', requiredPermission: 'database:query' },
  { path: '/admin/logs', label: '服务日志', icon: 'file-text', module: 'system', requiredPermission: 'sync:read' },

  // Task 模块
  { path: '/task/dashboard', label: '任务仪表盘', icon: 'layout-dashboard', module: 'task', requiredPermission: 'task:read' },
  { path: '/task/definitions', label: '任务定义', icon: 'list-checks', module: 'task', requiredPermission: 'task:manage' },
  { path: '/task/history', label: '执行历史', icon: 'history', module: 'task', requiredPermission: 'task:read' },

  // System 模块
  { path: '/settings', label: '设置', icon: 'settings', module: 'system', requiresTauri: true },
  { path: '/profile', label: '个人资料', icon: 'user', module: 'auth' },
];
