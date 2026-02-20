import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ModuleRail from './ModuleRail';
import ContextSidebar from './ContextSidebar';
import {
  navigationModules,
  bottomNavItems,
  findModuleByTab,
} from '../../config/navigationConfig';
import type { TabType } from '../../types/navigation';
import type { QueueCounts } from '../../types/server';
import { useAuthContext } from '../../context/AuthContext';

interface AppShellProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  queueCounts?: QueueCounts | null;
  children: React.ReactNode;
}

const AppShell: React.FC<AppShellProps> = ({
  activeTab,
  setActiveTab,
  queueCounts,
  children,
}) => {
  const { isAdmin, user } = useAuthContext();
  const username = user?.username;
  const [activeModuleId, setActiveModuleId] = useState<string>('ticket');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 根据权限过滤可见模块
  const visibleModules = useMemo(
    () => navigationModules.filter(m => !m.requireAdmin || isAdmin),
    [isAdmin],
  );

  // 当 activeTab 变化时，同步 activeModule
  useEffect(() => {
    const mod = findModuleByTab(activeTab);
    if (mod) {
      setActiveModuleId(mod.id);
      // 如果是从折叠状态点击进入模块页面（如浮动 Widget 导航），自动展开
      setSidebarCollapsed(false);
    }
  }, [activeTab]);

  // 点击模块图标
  const handleModuleClick = useCallback((moduleId: string) => {
    if (moduleId === activeModuleId) {
      // 当前 activeTab 不在该模块内（如从 profile/settings 回来），
      // 需要导航到模块首页而非仅切换折叠
      const currentInModule = findModuleByTab(activeTab)?.id === moduleId;
      if (currentInModule) {
        setSidebarCollapsed(prev => !prev);
        return;
      }
    }

    // 切换模块：展开 Sidebar，导航到该模块的第一个页面
    setActiveModuleId(moduleId);
    setSidebarCollapsed(false);
    const mod = navigationModules.find(m => m.id === moduleId);
    if (mod?.pages[0]) {
      setActiveTab(mod.pages[0].tab);
    }
  }, [activeModuleId, activeTab, setActiveTab]);

  // 点击 Sidebar 中的页面项
  const handlePageClick = useCallback((tab: string) => {
    setActiveTab(tab as TabType);
  }, [setActiveTab]);

  // 点击底部独立项（设置等）
  const handleBottomItemClick = useCallback((tab: string) => {
    setSidebarCollapsed(true); // 底部项不展开 Sidebar
    setActiveTab(tab as TabType);
  }, [setActiveTab]);

  // 点击用户头像
  const handleProfileClick = useCallback(() => {
    setSidebarCollapsed(true);
    setActiveTab('profile');
  }, [setActiveTab]);

  // 折叠 Sidebar
  const handleCollapse = useCallback(() => {
    setSidebarCollapsed(true);
  }, []);

  // 当前选中的模块对象
  const activeModule = useMemo(
    () => visibleModules.find(m => m.id === activeModuleId),
    [visibleModules, activeModuleId],
  );

  // 判断当前 activeTab 是否属于某个模块（非底部独立项）
  const isInModule = !!findModuleByTab(activeTab);

  // Sidebar 是否应该展开（在模块内 + 有模块数据 + 未折叠）
  const sidebarVisible = !!activeModule && isInModule && !sidebarCollapsed;

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
      <ModuleRail
        modules={visibleModules}
        activeModuleId={activeModuleId}
        sidebarCollapsed={!sidebarVisible}
        onModuleClick={handleModuleClick}
        bottomItems={bottomNavItems}
        onBottomItemClick={handleBottomItemClick}
        activeTab={activeTab}
        username={username}
        onProfileClick={handleProfileClick}
        isProfileActive={activeTab === 'profile'}
        queueCounts={queueCounts}
      />

      {/* Context Sidebar — CSS 过渡动画，不做条件渲染 */}
      {activeModule && isInModule && (
        <div
          className={`overflow-hidden transition-all duration-300 ease-out flex-shrink-0
            ${sidebarVisible
              ? 'w-[220px] opacity-100'
              : 'w-0 opacity-0'
            }`}
        >
          <ContextSidebar
            module={activeModule}
            activeTab={activeTab}
            isAdmin={isAdmin}
            onPageClick={handlePageClick}
            onCollapse={handleCollapse}
            queueCounts={queueCounts}
          />
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {children}
      </div>
    </div>
  );
};

export default AppShell;
