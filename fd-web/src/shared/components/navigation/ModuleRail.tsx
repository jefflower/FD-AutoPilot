import React, { useState } from 'react';
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
  hovered: string;
  indicator: string;
  badge: string;
  label: string;       // hover 标签背景 + 文字
  glowRgb: string;
}> = {
  indigo: {
    active: 'bg-indigo-500/15 text-indigo-400',
    collapsed: 'bg-indigo-500/20 text-indigo-300',
    hovered: 'bg-indigo-500/10 text-indigo-400',
    indicator: 'bg-indigo-400',
    badge: 'bg-indigo-500',
    label: 'bg-indigo-500/90 text-white',
    glowRgb: '99, 102, 241',
  },
  amber: {
    active: 'bg-amber-500/15 text-amber-400',
    collapsed: 'bg-amber-500/20 text-amber-300',
    hovered: 'bg-amber-500/10 text-amber-400',
    indicator: 'bg-amber-400',
    badge: 'bg-amber-500',
    label: 'bg-amber-500/90 text-white',
    glowRgb: '245, 158, 11',
  },
  cyan: {
    active: 'bg-cyan-500/15 text-cyan-400',
    collapsed: 'bg-cyan-500/20 text-cyan-300',
    hovered: 'bg-cyan-500/10 text-cyan-400',
    indicator: 'bg-cyan-400',
    badge: 'bg-cyan-500',
    label: 'bg-cyan-500/90 text-white',
    glowRgb: '6, 182, 212',
  },
};

export type ConnectionIndicatorStatus = 'green' | 'yellow' | 'red';

interface ModuleRailProps {
  modules: NavModule[];
  activeModuleId: string;
  sidebarCollapsed: boolean;
  onModuleClick: (moduleId: string) => void;
  onModuleHover?: (moduleId: string | null) => void;
  bottomItems: BottomNavItem[];
  onBottomItemClick: (tab: string) => void;
  activeTab: string;
  username?: string;
  onProfileClick: () => void;
  isProfileActive: boolean;
  queueCounts?: QueueCounts | null;
  connectionStatus?: ConnectionIndicatorStatus;
  connectionTooltip?: string;
}

const ModuleRail: React.FC<ModuleRailProps> = ({
  modules,
  activeModuleId,
  sidebarCollapsed,
  onModuleClick,
  onModuleHover,
  bottomItems,
  onBottomItemClick,
  activeTab,
  username,
  onProfileClick,
  isProfileActive,
  queueCounts,
  connectionStatus = 'red',
  connectionTooltip,
}) => {
  const { t } = useTranslation('common');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="w-14 min-w-14 h-full bg-slate-950/80 backdrop-blur-xl border-r border-white/5 flex flex-col items-center py-4 flex-shrink-0 select-none">
      {/* Logo */}
      <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-base shadow-lg shadow-indigo-500/25 flex-shrink-0">
        F
      </div>

      {/* Module Icons */}
      <div className="flex-1 flex flex-col items-center gap-1 mt-6 w-full overflow-visible">
        {modules.map((mod) => {
          const isActive = activeModuleId === mod.id;
          const colors = colorMap[mod.color] || colorMap.indigo;
          const badge = getModuleBadge(mod, queueCounts);
          const Icon = mod.icon;
          const isHovered = hoveredId === mod.id;

          const isCollapsedActive = isActive && sidebarCollapsed;
          const isExpandedActive = isActive && !sidebarCollapsed;
          const isHoveredIdle = isHovered && !isActive;

          // 左侧指示条：仅展开选中态
          const indicatorClass = isExpandedActive
            ? `h-5 opacity-100 ${colors.indicator}`
            : 'h-0 opacity-0 bg-transparent';

          return (
            <div
              key={mod.id}
              className="relative w-full flex justify-center"
              onMouseEnter={() => { setHoveredId(mod.id); onModuleHover?.(mod.id); }}
              onMouseLeave={() => { setHoveredId(null); onModuleHover?.(null); }}
            >
              {/* Left indicator bar */}
              <div
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full transition-all duration-300 ease-out ${indicatorClass}`}
              />

              <button
                onClick={() => onModuleClick(mod.id)}
                className={`w-10 h-10 rounded-xl flex items-center justify-center relative z-10
                  transition-all duration-200
                  ${isCollapsedActive
                    ? `${colors.collapsed} module-icon-glow`
                    : isExpandedActive
                      ? colors.active
                      : isHoveredIdle
                        ? colors.hovered
                        : 'text-slate-500 hover:text-slate-400'
                  }`}
                style={isCollapsedActive
                  ? { '--glow-rgb': colors.glowRgb } as React.CSSProperties
                  : isHoveredIdle
                    ? { boxShadow: `0 0 12px rgba(${colors.glowRgb}, 0.15)` }
                    : undefined}
              >
                <Icon
                  size={20}
                  strokeWidth={isCollapsedActive ? 2.2 : 1.8}
                  className="transition-all duration-200"
                />

                {/* Badge dot */}
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

        {/* Connection Status Indicator */}
        <div className="relative group mt-1" title={connectionTooltip}>
          <span
            className={`block w-2 h-2 rounded-full transition-all duration-300
              ${connectionStatus === 'green'
                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)] animate-pulse'
                : connectionStatus === 'yellow'
                  ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]'
                  : 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]'
              }`}
          />
          {/* Tooltip */}
          <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-slate-800 border border-white/10 rounded-lg text-xs text-slate-200 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200 z-50 shadow-xl">
            {connectionTooltip || 'Unknown'}
          </div>
        </div>

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
