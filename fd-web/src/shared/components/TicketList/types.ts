import type React from 'react';
import type { ServerTicket } from '../../types/server';

// ============ Theme ============

export type ThemeColor = 'indigo' | 'purple' | 'emerald' | 'amber' | 'blue' | 'red';

export interface ThemeTokens {
  selected: string;
  border: string;
  shadow: string;
  accent: string;
  id: string;
  indicator: string;
}

export const THEME_MAP: Record<ThemeColor, ThemeTokens> = {
  indigo: {
    selected: 'bg-indigo-500/10 border-indigo-500/30',
    border: 'border-l-indigo-500',
    shadow: 'shadow-lg shadow-indigo-500/5',
    accent: 'text-indigo-400',
    id: 'text-indigo-400/80',
    indicator: 'bg-indigo-500',
  },
  purple: {
    selected: 'bg-purple-500/10 border-purple-500/30',
    border: 'border-l-purple-500',
    shadow: 'shadow-lg shadow-purple-500/5',
    accent: 'text-purple-400',
    id: 'text-purple-400/80',
    indicator: 'bg-purple-500',
  },
  emerald: {
    selected: 'bg-emerald-500/10 border-emerald-500/30',
    border: 'border-l-emerald-500',
    shadow: 'shadow-lg shadow-emerald-500/5',
    accent: 'text-emerald-400',
    id: 'text-emerald-400/80',
    indicator: 'bg-emerald-500',
  },
  amber: {
    selected: 'bg-amber-500/10 border-amber-500/30',
    border: 'border-l-amber-500',
    shadow: 'shadow-lg shadow-amber-500/5',
    accent: 'text-amber-400',
    id: 'text-amber-400/80',
    indicator: 'bg-amber-500',
  },
  blue: {
    selected: 'bg-blue-500/10 border-blue-500/30',
    border: 'border-l-blue-500',
    shadow: 'shadow-lg shadow-blue-500/5',
    accent: 'text-blue-400',
    id: 'text-blue-400/80',
    indicator: 'bg-blue-500',
  },
  red: {
    selected: 'bg-red-500/10 border-red-500/30',
    border: 'border-l-red-500',
    shadow: 'shadow-lg shadow-red-500/5',
    accent: 'text-red-400',
    id: 'text-red-400/80',
    indicator: 'bg-red-500',
  },
};

// ============ Title Mode ============

export type TitleMode = 'original' | 'translated' | 'auto';

// ============ Pagination ============

export type PaginationConfig =
  | { mode: 'infinite'; hasMore: boolean; loadMore: () => void; loadingMore?: boolean }
  | { mode: 'pages'; page: number; totalPages: number; totalElements: number; onPageChange: (page: number) => void };

// ============ Props ============

export interface TicketListProps {
  /** 工单数据 */
  tickets: ServerTicket[];
  /** 当前选中的工单 ID */
  selectedId?: number | null;
  /** 选中回调 */
  onSelect?: (ticket: ServerTicket) => void;
  /** 主题色 */
  themeColor?: ThemeColor;
  /** 标题显示模式 */
  titleMode?: TitleMode;

  // ---- Checkbox 多选 ----
  /** 是否显示 checkbox */
  selectable?: boolean;
  /** 已选中的 ID 集合（受控） */
  selectedIds?: Set<number>;
  /** 选中/取消回调 */
  onSelectionChange?: (ids: Set<number>) => void;

  // ---- 插槽 ----
  /** 状态标签右侧的额外操作按钮 (hover 时显示) */
  renderActions?: (ticket: ServerTicket) => React.ReactNode;
  /** 标题下方的额外内容 */
  renderExtra?: (ticket: ServerTicket) => React.ReactNode;
  /** 自定义列表项右上角的状态标签，不传则使用默认状态标签 */
  renderStatus?: (ticket: ServerTicket) => React.ReactNode;

  // ---- 分页 ----
  /** 分页模式 */
  pagination?: PaginationConfig;

  // ---- 状态 ----
  loading?: boolean;
  emptyText?: string;

  // ---- 样式 ----
  className?: string;
  /** 列表项内边距，默认 'normal' */
  density?: 'compact' | 'normal';
}

// ============ Item Props ============

export interface TicketListItemProps {
  ticket: ServerTicket;
  isSelected: boolean;
  theme: ThemeTokens;
  titleMode: TitleMode;
  density: 'compact' | 'normal';
  onSelect?: (ticket: ServerTicket) => void;

  // checkbox
  selectable?: boolean;
  isChecked?: boolean;
  onCheckChange?: (ticketId: number, checked: boolean) => void;

  // slots
  renderActions?: (ticket: ServerTicket) => React.ReactNode;
  renderExtra?: (ticket: ServerTicket) => React.ReactNode;
  renderStatus?: (ticket: ServerTicket) => React.ReactNode;
}

// ============ Pagination Props ============

export interface PaginationProps {
  page: number;
  totalPages: number;
  totalElements: number;
  onPageChange: (page: number) => void;
}
