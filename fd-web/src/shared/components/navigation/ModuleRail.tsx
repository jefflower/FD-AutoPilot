import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { NavModule, BottomNavItem } from '../../config/navigationConfig';
import type { QueueCounts } from '../../types/server';
import { getModuleBadge } from '../../config/navigationConfig';

/** i18next 动态 key 辅助：绕过严格字面量类型检查 */
const tDynamic = (t: TFunction, key: string): string => t(key as never);

/** 模块主题色映射 */
const colorMap: Record<string, {
  active: string;
  collapsed: string;
  indicator: string;
  badge: string;
  glowRgb: string;  // RGB for CSS variable --glow-rgb
}> = {
  indigo: {
    active: 'bg-indigo-500/15 text-indigo-400',
    collapsed: 'bg-indigo-500/20 text-indigo-300',
    indicator: 'bg-indigo-400',
    badge: 'bg-indigo-500',
    glowRgb: '99, 102, 241',
  },
  amber: {
    active: 'bg-amber-500/15 text-amber-400',
    collapsed: 'bg-amber-500/20 text-amber-300',
    indicator: 'bg-amber-400',
    badge: 'bg-amber-500',
    glowRgb: '245, 158, 11',
  },
  cyan: {
    active: 'bg-cyan-500/15 text-cyan-400',
    collapsed: 'bg-cyan-500/20 text-cyan-300',
    indicator: 'bg-cyan-400',
    badge: 'bg-cyan-500',
    glowRgb: '6, 182, 212',
  },
};

interface ModuleRailProps {
  modules: NavModule[];
  activeModuleId: string;
  sidebarCollapsed: boolean;
  onModuleClick: (moduleId: string) => void;
  bottomItems: BottomNavItem[];
  onBottomItemClick: (tab: string) => void;
  activeTab: string;
  username?: string;
  onProfileClick: () => void;
  isProfileActive: boolean;
  queueCounts?: QueueCounts | null;
}

const ModuleRail: React.FC<ModuleRailProps> = ({
  modules,
  activeModuleId,
  sidebarCollapsed,
  onModuleClick,
  bottomItems,
  onBottomItemClick,
  activeTab,
  username,
  onProfileClick,
  isProfileActive,
  queueCounts,
}) => {
  const { t } = useTranslation('common');

  return (
    <div className="w-14 min-w-14 bg-slate-950/80 backdrop-blur-xl border-r border-white/5 flex flex-col items-center py-4 flex-shrink-0 select-none">
      {/* Logo */}
      <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-base shadow-lg shadow-indigo-500/25 flex-shrink-0">
        F
      </div>

      {/* Module Icons */}
      <div className="flex-1 flex flex-col items-center gap-1 mt-6 w-full">
        {modules.map((mod) => {
          const isActive = activeModuleId === mod.id;
          const colors = colorMap[mod.color] || colorMap.indigo;
          const badge = getModuleBadge(mod, queueCounts);
          const Icon = mod.icon;

          // 三态：展开选中 / 折叠选中 / 未选中
          const isCollapsedActive = isActive && sidebarCollapsed;
          const isExpandedActive = isActive && !sidebarCollapsed;

          return (
            <div key={mod.id} className="relative w-full flex justify-center">
              {/* Left indicator bar — 仅展开选中时显示，带动画 */}
              <div
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full transition-all duration-300 ease-out
                  ${isExpandedActive
                    ? `h-5 opacity-100 ${colors.indicator}`
                    : 'h-0 opacity-0 bg-transparent'
                  }`}
              />

              <button
                onClick={() => onModuleClick(mod.id)}
                className={`w-10 h-10 rounded-xl flex items-center justify-center relative
                  transition-all duration-300 ease-out
                  ${isCollapsedActive
                    ? `${colors.collapsed} scale-110 module-icon-glow`
                    : isExpandedActive
                      ? colors.active
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/5 scale-100'
                  }`}
                style={isCollapsedActive ? { '--glow-rgb': colors.glowRgb } as React.CSSProperties : undefined}
                title={tDynamic(t, mod.labelKey)}
              >
                <Icon
                  size={20}
                  strokeWidth={isCollapsedActive ? 2.2 : 1.8}
                  className="transition-all duration-300"
                />

                {/* Module badge dot */}
                {badge > 0 && (
                  <span className={`absolute top-1 right-1 w-2 h-2 rounded-full ${colors.badge} ring-2 ring-slate-950 transition-all duration-300`} />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Bottom Items */}
      <div className="flex flex-col items-center gap-1 w-full">
        {bottomItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.tab;
          return (
            <button
              key={item.tab}
              onClick={() => onBottomItemClick(item.tab)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200
                ${isActive ? 'bg-white/10 text-slate-200' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
              title={tDynamic(t, item.labelKey)}
            >
              <Icon size={20} strokeWidth={1.8} />
            </button>
          );
        })}

        {/* User Avatar */}
        <button
          onClick={onProfileClick}
          className={`w-8 h-8 mt-1 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-medium transition-all duration-200 hover:scale-110 shadow-lg shadow-indigo-500/25
            ${isProfileActive ? 'ring-2 ring-white/50' : ''}`}
          title={username || t('label.user')}
        >
          {username?.charAt(0).toUpperCase() || 'U'}
        </button>
      </div>
    </div>
  );
};

export default ModuleRail;
