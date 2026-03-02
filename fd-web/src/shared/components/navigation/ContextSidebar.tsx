import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronsLeft, Pin } from 'lucide-react';
import type { NavModule } from '../../config/navigationConfig';
import type { QueueCounts } from '../../types/server';

/** i18next 动态 key 辅助 */
const tDynamic = (t: TFunction, key: string): string => t(key as never);

/** Sidebar 中每个页面项的颜色映射（选中态左边框色） */
const borderColorMap: Record<string, string> = {
  indigo: 'border-l-indigo-400',
  amber: 'border-l-amber-400',
  cyan: 'border-l-cyan-400',
};

const titleColorMap: Record<string, string> = {
  indigo: 'text-indigo-400',
  amber: 'text-amber-400',
  cyan: 'text-cyan-400',
};

interface ContextSidebarProps {
  module: NavModule;
  activeTab: string;
  isAdmin: boolean;
  onPageClick: (tab: string) => void;
  onCollapse: () => void;
  onPin?: () => void;
  queueCounts?: QueueCounts | null;
  isOverlay?: boolean;
  /** 空闲自动折叠倒计时（秒），null 表示未激活 */
  idleCountdown?: number | null;
}

const ContextSidebar: React.FC<ContextSidebarProps> = ({
  module,
  activeTab,
  isAdmin,
  onPageClick,
  onCollapse,
  onPin,
  queueCounts,
  isOverlay = false,
  idleCountdown,
}) => {
  const { t } = useTranslation('common');
  const borderColor = borderColorMap[module.color] || borderColorMap.indigo;
  const titleColor = titleColorMap[module.color] || titleColorMap.indigo;

  return (
    <div className={`bg-slate-900/60 backdrop-blur-xl border-r border-white/5 flex flex-col flex-shrink-0 select-none ${
      isOverlay
        ? 'h-full w-full overflow-hidden'
        : 'w-[220px] min-w-[220px]'
    }`}>
      {/* Module Header */}
      <div className="px-4 pt-4 pb-3">
        <h2 className={`text-sm font-semibold ${titleColor}`}>
          {tDynamic(t, module.labelKey)}
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          {tDynamic(t, module.descKey)}
        </p>
      </div>

      <div className="h-px bg-white/5 mx-3" />

      {/* Page List */}
      <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
        {module.pages.filter(p => !p.requireAdmin || isAdmin).map((page) => {
          const isActive = activeTab === page.tab;
          const Icon = page.icon;
          const badge = page.badgeKey && queueCounts?.[page.badgeKey];

          return (
            <button
              key={page.tab}
              onClick={() => onPageClick(page.tab)}
              className={`w-full h-9 px-3 rounded-lg flex items-center gap-3 transition-all duration-150 text-left
                ${isActive
                  ? `bg-white/5 text-white border-l-2 ${borderColor}`
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border-l-2 border-l-transparent'
                }`}
            >
              <Icon size={16} strokeWidth={1.8} className="flex-shrink-0" />
              <span className="text-sm flex-1 truncate">{tDynamic(t, page.labelKey)}</span>
              {badge != null && badge > 0 && (
                <span className="min-w-5 h-5 px-1.5 bg-red-500/80 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Action Button */}
      <div className="px-2 pb-3">
        {isOverlay && onPin ? (
          <button
            onClick={onPin}
            className="w-full h-8 rounded-lg flex items-center justify-center gap-2 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all duration-150"
          >
            <Pin size={14} />
            <span className="text-xs">{t('sidebar.pin')}</span>
          </button>
        ) : (
          <button
            onClick={onCollapse}
            className="w-full h-8 rounded-lg flex items-center justify-center gap-2 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all duration-150"
          >
            <ChevronsLeft size={14} />
            <span className="text-xs">{t('sidebar.collapse')}</span>
            {idleCountdown != null && idleCountdown > 0 && (
              <span className="text-[10px] text-slate-600 tabular-nums ml-auto">{idleCountdown}s</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default ContextSidebar;
