import {
  Server, Send,
  Users, Shield, RefreshCw, FileText, Database, BookOpen,
  LayoutDashboard, ListChecks, History, Settings, User, Bot,
  Building2, GitBranch, BookMarked, Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { TabType } from '../types/navigation';
import type { QueueCounts } from '../types/server';

export interface NavPage {
  tab: TabType;
  labelKey: string;
  icon: LucideIcon;
  badgeKey?: keyof QueueCounts;
  requireAdmin?: boolean;
}

export interface NavModule {
  id: string;
  labelKey: string;
  descKey: string;
  icon: LucideIcon;
  color: string;           // tailwind color name: 'indigo' | 'amber' | 'cyan'
  requireAdmin?: boolean;
  pages: NavPage[];
}

export interface BottomNavItem {
  tab: TabType;
  labelKey: string;
  icon: LucideIcon;
}

export const navigationModules: NavModule[] = [
  {
    id: 'ticket',
    labelKey: 'module.ticket',
    descKey: 'moduleDesc.ticket',
    icon: Server,
    color: 'indigo',
    pages: [
      { tab: 'server-tickets', labelKey: 'nav.server', icon: Server },
      { tab: 'automation', labelKey: 'nav.automation', icon: Workflow, badgeKey: 'translation' },
      { tab: 'agent-automation', labelKey: 'nav.agentAutomation', icon: Bot },
      { tab: 'approved', labelKey: 'nav.push', icon: Send },
      { tab: 'knowledge', labelKey: 'nav.knowledge', icon: BookOpen },
      { tab: 'manual-sync', labelKey: 'nav.sync', icon: RefreshCw, requireAdmin: true },
    ],
  },
  {
    id: 'admin',
    labelKey: 'module.admin',
    descKey: 'moduleDesc.admin',
    icon: Shield,
    color: 'amber',
    requireAdmin: true,
    pages: [
      { tab: 'admin-users', labelKey: 'nav.users', icon: Users },
      { tab: 'role-permission', labelKey: 'nav.rolePermission', icon: Shield },
      { tab: 'server-logs', labelKey: 'nav.logs', icon: FileText },
      { tab: 'database', labelKey: 'nav.database', icon: Database },
      { tab: 'org-sync', labelKey: 'nav.orgSync', icon: Building2 },
      { tab: 'agent-manage', labelKey: 'nav.agentManage', icon: Bot },
    ],
  },
  {
    id: 'task',
    labelKey: 'module.task',
    descKey: 'moduleDesc.task',
    icon: ListChecks,
    color: 'cyan',
    requireAdmin: true,
    pages: [
      { tab: 'task-dashboard', labelKey: 'nav.taskDashboard', icon: LayoutDashboard },
      { tab: 'task-definitions', labelKey: 'nav.taskDefinitions', icon: ListChecks },
      { tab: 'task-history', labelKey: 'nav.taskHistory', icon: History },
    ],
  },
  {
    id: 'workflow',
    labelKey: 'module.workflow',
    descKey: 'moduleDesc.workflow',
    icon: GitBranch,
    color: 'purple',
    requireAdmin: true,
    pages: [
      { tab: 'workflow-list', labelKey: 'nav.workflowList', icon: GitBranch },
      { tab: 'workflow-agents', labelKey: 'nav.workflowAgents', icon: Bot },
      { tab: 'workflow-guide', labelKey: 'nav.workflowGuide', icon: BookMarked },
    ],
  },
];

export const bottomNavItems: BottomNavItem[] = [
  { tab: 'settings', labelKey: 'nav.settings', icon: Settings },
];

export const profileNavItem: BottomNavItem = {
  tab: 'profile', labelKey: 'nav.profile', icon: User,
};

/** 根据 TabType 查找所属模块 */
export function findModuleByTab(tab: TabType): NavModule | undefined {
  return navigationModules.find(m => m.pages.some(p => p.tab === tab));
}

/** 计算模块的汇总 badge */
export function getModuleBadge(module: NavModule, queueCounts?: QueueCounts | null): number {
  if (!queueCounts) return 0;
  return module.pages.reduce((sum, page) => {
    if (page.badgeKey && queueCounts[page.badgeKey]) {
      return sum + queueCounts[page.badgeKey];
    }
    return sum;
  }, 0);
}
