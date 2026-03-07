import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Server, ClipboardCheck, AlertTriangle, Activity, MoreHorizontal, X } from 'lucide-react';
import type { TabType } from '../../types/navigation';
import type { QueueCounts } from '../../types/server';
import { navigationModules } from '../../config/navigationConfig';
import type { NavModule } from '../../config/navigationConfig';

/** i18next 动态 key 辅助 */
const tDynamic = (t: TFunction, key: string): string => t(key as never);

interface MobileBottomNavProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  queueCounts?: QueueCounts | null;
  isAdmin?: boolean;
}

/** 底部固定 Tab 配置 */
interface PrimaryTab {
  tab: TabType;
  labelKey: string;
  icon: typeof Server;
  badgeKey?: keyof QueueCounts;
}

const primaryTabs: PrimaryTab[] = [
  { tab: 'server-tickets', labelKey: 'nav.server', icon: Server },
  { tab: 'audit-center', labelKey: 'nav.auditCenter', icon: ClipboardCheck, badgeKey: 'audit' },
  { tab: 'manual-required', labelKey: 'nav.manualRequired', icon: AlertTriangle },
  { tab: 'ai-dashboard', labelKey: 'nav.cyberOffice', icon: Activity },
];

const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  setActiveTab,
  queueCounts,
  isAdmin,
}) => {
  const { t } = useTranslation('common');
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭 sheet
  useEffect(() => {
    if (!sheetOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setSheetOpen(false);
      }
    };
    // 延迟注册，避免同一次点击事件立即关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [sheetOpen]);

  // 按 ESC 关闭
  useEffect(() => {
    if (!sheetOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sheetOpen]);

  const handleTabClick = useCallback((tab: TabType) => {
    setActiveTab(tab);
    setSheetOpen(false);
  }, [setActiveTab]);

  const handleMoreClick = useCallback(() => {
    setSheetOpen(prev => !prev);
  }, []);

  // 判断 tab 是否属于主 tab 列表
  const isPrimaryTab = primaryTabs.some(t => t.tab === activeTab);
  // "更多" tab 高亮：sheet 打开时，或当前 activeTab 不在主 tab 列表中
  const isMoreActive = sheetOpen || !isPrimaryTab;

  // 过滤可见模块（基于 admin 权限）
  const visibleModules = navigationModules.filter(m => !m.requireAdmin || isAdmin);

  // 收集主 tab 之外的所有页面
  const primaryTabSet = new Set(primaryTabs.map(t => t.tab));

  return (
    <>
      {/* Bottom Sheet Overlay */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
      )}

      {/* Bottom Sheet */}
      <div
        ref={sheetRef}
        className={`fixed left-0 right-0 bottom-0 z-50 transition-transform duration-300 ease-out
          ${sheetOpen ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="bg-slate-900 border-t border-white/10 rounded-t-2xl max-h-[60vh] overflow-y-auto">
          {/* Sheet 标题栏 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 sticky top-0 bg-slate-900 rounded-t-2xl">
            <span className="text-sm font-medium text-slate-300">
              {t('nav.allModules' as never)}
            </span>
            <button
              onClick={() => setSheetOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* 模块列表 */}
          <div className="px-3 py-2 space-y-3">
            {visibleModules.map((mod: NavModule) => (
              <div key={mod.id}>
                {/* 模块标题 */}
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <mod.icon size={14} className="text-slate-500" />
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {tDynamic(t, mod.labelKey)}
                  </span>
                </div>
                {/* 页面项 */}
                <div className="grid grid-cols-3 gap-1">
                  {mod.pages
                    .filter(p => !p.requireAdmin || isAdmin)
                    .map(page => {
                      const isActive = activeTab === page.tab;
                      const inPrimary = primaryTabSet.has(page.tab);
                      return (
                        <button
                          key={page.tab}
                          onClick={() => handleTabClick(page.tab)}
                          className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg transition-colors
                            ${isActive
                              ? 'bg-blue-500/15 text-blue-400'
                              : 'text-slate-400 hover:bg-white/5 hover:text-slate-300'
                            }
                            ${inPrimary ? 'opacity-60' : ''}`}
                        >
                          <page.icon size={18} />
                          <span className="text-[10px] leading-tight text-center line-clamp-1">
                            {tDynamic(t, page.labelKey)}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}

            {/* 设置和个人资料 */}
            <div>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  {t('nav.settings' as never)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(['settings', 'profile'] as TabType[]).map(tab => {
                  const isActive = activeTab === tab;
                  const label = tab === 'settings' ? t('nav.settings' as never) : t('nav.profile' as never);
                  return (
                    <button
                      key={tab}
                      onClick={() => handleTabClick(tab)}
                      className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg transition-colors
                        ${isActive
                          ? 'bg-blue-500/15 text-blue-400'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-300'
                        }`}
                    >
                      <span className="text-[10px] leading-tight text-center">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 底部安全区域占位 */}
          <div className="h-2" />
        </div>
      </div>

      {/* 底部导航栏 */}
      <nav
        className="flex-shrink-0 bg-slate-900 border-t border-white/10 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-center justify-around h-14">
          {primaryTabs.map(item => {
            const isActive = activeTab === item.tab && !sheetOpen;
            const badgeCount = item.badgeKey && queueCounts ? queueCounts[item.badgeKey] : 0;
            return (
              <button
                key={item.tab}
                onClick={() => handleTabClick(item.tab)}
                className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors
                  ${isActive ? 'text-blue-400' : 'text-slate-500'}`}
              >
                <div className="relative">
                  <item.icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
                  {!!badgeCount && badgeCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 flex items-center justify-center
                      bg-red-500 text-white text-[10px] font-bold rounded-full leading-none">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] leading-tight ${isActive ? 'font-medium' : ''}`}>
                  {tDynamic(t, item.labelKey)}
                </span>
              </button>
            );
          })}

          {/* 更多 Tab */}
          <button
            onClick={handleMoreClick}
            className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors
              ${isMoreActive ? 'text-blue-400' : 'text-slate-500'}`}
          >
            <MoreHorizontal size={20} strokeWidth={isMoreActive ? 2.5 : 1.5} />
            <span className={`text-[10px] leading-tight ${isMoreActive ? 'font-medium' : ''}`}>
              {t('nav.more' as never)}
            </span>
          </button>
        </div>
      </nav>
    </>
  );
};

export default MobileBottomNav;
