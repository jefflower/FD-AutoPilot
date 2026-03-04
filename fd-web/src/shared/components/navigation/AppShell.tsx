import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ModuleRail from './ModuleRail';
import type { ConnectionIndicatorStatus } from './ModuleRail';
import ContextSidebar from './ContextSidebar';
import {
  navigationModules,
  bottomNavItems,
  findModuleByTab,
} from '../../config/navigationConfig';
import type { TabType } from '../../types/navigation';
import type { QueueCounts } from '../../types/server';
import { useAuthContext } from '../../context/AuthContext';
import { useServerEvents } from '../../context/ServerEventsContext';
import {
  getHeartbeatStatus,
  onHeartbeatStatusChange,
  type HeartbeatStatus,
} from '../../services/clientRegistration';

interface AppShellProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  queueCounts?: QueueCounts | null;
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = 'fd_sidebar_collapsed';
const SIDEBAR_AUTO_COLLAPSE_ENABLED_KEY = 'fd_sidebar_auto_collapse_enabled';
const SIDEBAR_COLLAPSE_SECONDS_KEY = 'fd_sidebar_collapse_seconds';
const DEFAULT_COLLAPSE_SECONDS = 15;

/** 从 localStorage 读取自动收起配置 */
function loadAutoCollapseConfig(): { enabled: boolean; seconds: number } {
  try {
    const enabledStr = localStorage.getItem(SIDEBAR_AUTO_COLLAPSE_ENABLED_KEY);
    const secondsStr = localStorage.getItem(SIDEBAR_COLLAPSE_SECONDS_KEY);
    return {
      enabled: enabledStr !== null ? JSON.parse(enabledStr) : true,
      seconds: secondsStr !== null ? Math.max(5, Math.min(120, Number(secondsStr))) : DEFAULT_COLLAPSE_SECONDS,
    };
  } catch {
    return { enabled: true, seconds: DEFAULT_COLLAPSE_SECONDS };
  }
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

  // ---- 自动收起配置 ----
  const [autoCollapseEnabled, setAutoCollapseEnabledState] = useState(() => loadAutoCollapseConfig().enabled);
  const [collapseSeconds, setCollapseSecondsState] = useState(() => loadAutoCollapseConfig().seconds);

  // 更新自动收起开关并保存到 localStorage
  const setAutoCollapseEnabled = useCallback((enabled: boolean) => {
    setAutoCollapseEnabledState(enabled);
    try {
      localStorage.setItem(SIDEBAR_AUTO_COLLAPSE_ENABLED_KEY, JSON.stringify(enabled));
    } catch { /* 忽略 localStorage 错误 */ }
  }, []);

  // 更新自动收起秒数并保存到 localStorage
  const setCollapseSeconds = useCallback((seconds: number) => {
    const clamped = Math.max(5, Math.min(120, seconds));
    setCollapseSecondsState(clamped);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSE_SECONDS_KEY, String(clamped));
    } catch { /* 忽略 localStorage 错误 */ }
  }, []);

  // ---- Sidebar State: 从 localStorage 读取，默认折叠 ----
  // sidebarCollapsed=true 表示未锁定（折叠），false 表示锁定（常驻展开）
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      return saved !== null ? JSON.parse(saved) : true; // 默认折叠
    } catch {
      return true;
    }
  });

  // 折叠状态变化时同步写入 localStorage
  const setSidebarCollapsed = useCallback((collapsed: boolean | ((prev: boolean) => boolean)) => {
    const newValue = typeof collapsed === 'function' ? collapsed(sidebarCollapsed) : collapsed;
    setSidebarCollapsedState(newValue);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify(newValue));
    } catch {
      // 忽略 localStorage 错误
    }
  }, [sidebarCollapsed]);

  // ---- Hover 预览状态 ----
  const [hoveredModuleId, setHoveredModuleId] = useState<string | null>(null);
  const [isHoveringNav, setIsHoveringNav] = useState(false);
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- 空闲自动折叠：锁定展开状态下无侧栏交互则自动折叠（秒数和开关可配置） ----
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [idleCountdown, setIdleCountdown] = useState<number | null>(null);

  const clearIdleTimers = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIdleCountdown(null);
  }, []);

  const resetIdleTimer = useCallback(() => {
    clearIdleTimers();
    // 仅在非折叠且自动收起开启时启动计时
    if (!sidebarCollapsed && autoCollapseEnabled) {
      setIdleCountdown(collapseSeconds);
      // 每秒倒计时
      countdownIntervalRef.current = setInterval(() => {
        setIdleCountdown(prev => {
          if (prev === null || prev <= 1) return prev;
          return prev - 1;
        });
      }, 1000);
      // 到时自动折叠
      idleTimerRef.current = setTimeout(() => {
        clearIdleTimers();
        setSidebarCollapsedState(true);
        try {
          localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
        } catch { /* ignore */ }
      }, collapseSeconds * 1000);
    }
  }, [sidebarCollapsed, autoCollapseEnabled, collapseSeconds, clearIdleTimers]);

  // 侧栏展开/折叠变化时，重置或清除空闲计时器
  useEffect(() => {
    if (!sidebarCollapsed) {
      resetIdleTimer();
    } else {
      clearIdleTimers();
    }
    return clearIdleTimers;
  }, [sidebarCollapsed, resetIdleTimer, clearIdleTimers]);

  // ---- 响应式设计：窗口宽度监听 ----
  const [isSmallScreen, setIsSmallScreen] = useState(window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => {
      const small = window.innerWidth < 1024;
      setIsSmallScreen(small);
      // 小屏时自动折叠
      if (small) {
        setSidebarCollapsed(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setSidebarCollapsed]);

  // ---- 连接状态指示器 ----
  const serverEvents = useServerEvents();
  const sseStatus = serverEvents?.status ?? 'disconnected';
  const [heartbeatStatus, setHeartbeatStatus] = useState<HeartbeatStatus>(getHeartbeatStatus());

  useEffect(() => {
    return onHeartbeatStatusChange(setHeartbeatStatus);
  }, []);

  const { connectionStatus, connectionTooltip } = useMemo<{
    connectionStatus: ConnectionIndicatorStatus;
    connectionTooltip: string;
  }>(() => {
    const sseOk = sseStatus === 'connected';
    const hbOk = heartbeatStatus === 'connected';
    const sseConnecting = sseStatus === 'connecting';
    const hbRetrying = heartbeatStatus === 'retrying';

    if (sseOk && hbOk) {
      return { connectionStatus: 'green', connectionTooltip: 'SSE 已连接 | 心跳正常' };
    }
    if (sseConnecting || hbRetrying) {
      const parts: string[] = [];
      parts.push(`SSE: ${sseConnecting ? '连接中' : sseOk ? '已连接' : '已断开'}`);
      parts.push(`心跳: ${hbRetrying ? '重试中' : hbOk ? '正常' : '已断开'}`);
      return { connectionStatus: 'yellow', connectionTooltip: parts.join(' | ') };
    }
    // At least one is disconnected, none connecting/retrying
    const parts: string[] = [];
    parts.push(`SSE: ${sseOk ? '已连接' : '已断开'}`);
    parts.push(`心跳: ${hbOk ? '正常' : '已断开'}`);
    return { connectionStatus: 'red', connectionTooltip: parts.join(' | ') };
  }, [sseStatus, heartbeatStatus]);

  // 根据权限过滤可见模块
  const visibleModules = useMemo(
    () => navigationModules.filter(m => !m.requireAdmin || isAdmin),
    [isAdmin],
  );

  // 当 activeTab 变化时，同步 activeModule（不自动展开 sidebar）
  useEffect(() => {
    const mod = findModuleByTab(activeTab);
    if (mod) {
      setActiveModuleId(mod.id);
    }
  }, [activeTab]);

  // 点击模块图标
  const handleModuleClick = useCallback((moduleId: string) => {
    // 关闭 hover 预览（点击后由锁定状态接管）
    setIsHoveringNav(false);
    setHoveredModuleId(null);
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }

    if (moduleId === activeModuleId) {
      // 当前 activeTab 不在该模块内（如从 profile/settings 回来），
      // 需要导航到模块首页而非仅切换折叠
      const currentInModule = findModuleByTab(activeTab)?.id === moduleId;
      if (currentInModule) {
        // 当前已在该模块内，toggle 锁定状态
        setSidebarCollapsed(prev => !prev);
        return;
      }
    }

    // 切换模块：锁定展开 Sidebar，导航到该模块的第一个页面
    setActiveModuleId(moduleId);
    setSidebarCollapsed(false);
    const mod = navigationModules.find(m => m.id === moduleId);
    if (mod?.pages[0]) {
      setActiveTab(mod.pages[0].tab);
    }
  }, [activeModuleId, activeTab, setActiveTab, sidebarCollapsed]);

  // 点击 Sidebar 中的页面项
  const handlePageClick = useCallback((tab: string) => {
    setActiveTab(tab as TabType);
    resetIdleTimer(); // 点击页面项时重置空闲计时
    // 小屏下，导航后自动折叠侧边栏
    if (isSmallScreen) {
      setSidebarCollapsed(true);
    }
    // 浮层模式下，点击页面项后自动收起浮层
    setIsHoveringNav(false);
    setHoveredModuleId(null);
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
  }, [setActiveTab, isSmallScreen, setSidebarCollapsed, resetIdleTimer]);

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

  // 折叠 Sidebar（解除锁定）
  const handleCollapse = useCallback(() => {
    setSidebarCollapsed(true);
  }, []);

  // 锁定 Sidebar（从浮层模式锁定为常驻展开）
  const handlePin = useCallback(() => {
    // 如果 hover 的模块和 active 模块不同，先导航到 hover 模块
    if (hoveredModuleId && hoveredModuleId !== activeModuleId) {
      setActiveModuleId(hoveredModuleId);
      const mod = navigationModules.find(m => m.id === hoveredModuleId);
      if (mod?.pages[0]) {
        setActiveTab(mod.pages[0].tab);
      }
    }
    setSidebarCollapsed(false);
    // 清除 hover 状态
    setIsHoveringNav(false);
    setHoveredModuleId(null);
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
  }, [hoveredModuleId, activeModuleId, setActiveTab]);

  // Hover 进入导航区域（带去抖）
  const handleNavMouseEnter = useCallback(() => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    setIsHoveringNav(true);
  }, []);

  // Hover 离开导航区域（150ms 延迟去抖）
  const handleNavMouseLeave = useCallback(() => {
    hoverLeaveTimerRef.current = setTimeout(() => {
      setIsHoveringNav(false);
      setHoveredModuleId(null);
      hoverLeaveTimerRef.current = null;
    }, 150);
  }, []);

  // ModuleRail 中模块图标的 hover 回调
  const handleModuleHover = useCallback((moduleId: string | null) => {
    if (moduleId) {
      setHoveredModuleId(moduleId);
      handleNavMouseEnter();
    }
    // mouseLeave 由 handleNavMouseLeave 的去抖统一处理
  }, [handleNavMouseEnter]);

  // 清理 timer
  useEffect(() => {
    return () => {
      if (hoverLeaveTimerRef.current) {
        clearTimeout(hoverLeaveTimerRef.current);
      }
    };
  }, []);

  // 当前选中的模块对象
  const activeModule = useMemo(
    () => visibleModules.find(m => m.id === activeModuleId),
    [visibleModules, activeModuleId],
  );

  // 判断当前 activeTab 是否属于某个模块（非底部独立项）
  const isInModule = !!findModuleByTab(activeTab);

  // ---- 派生状态：锁定/浮层/可见性 ----
  // 锁定模式：侧栏未折叠且在模块内
  const isPinned = !sidebarCollapsed && !!activeModule && isInModule;
  // 浮层预览模式：未锁定 + hover 中 + 有 hover 模块
  const isHoverPreview = !isPinned && isHoveringNav && !!hoveredModuleId;
  // 是否为浮层模式（不占布局空间）
  const isOverlayMode = isHoverPreview && !isPinned;

  // 浮层时展示 hoveredModule，锁定时展示 activeModule
  const displayModule = useMemo(() => {
    if (isPinned) return activeModule;
    if (isHoverPreview) return visibleModules.find(m => m.id === hoveredModuleId);
    return null;
  }, [isPinned, isHoverPreview, activeModule, visibleModules, hoveredModuleId]);

  // ---- 一体化动效：计算 hovered 图标的 Y 位置和主题色 ----
  const hoveredModuleIndex = hoveredModuleId
    ? visibleModules.findIndex(m => m.id === hoveredModuleId)
    : -1;
  // Rail 布局: py-4(16) + logo h-9(36) + mt-6(24) = 76px 起始; 每行: h-10(40) + gap-1(4) = 44px
  const indicatorY = hoveredModuleIndex >= 0 ? 76 + hoveredModuleIndex * 44 + 20 : 0;
  const accentRgbMap: Record<string, string> = { indigo: '99,102,241', amber: '245,158,11', cyan: '6,182,212' };
  const accentRgb = displayModule ? (accentRgbMap[displayModule.color] || accentRgbMap.indigo) : accentRgbMap.indigo;

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
      {/* ModuleRail — onMouseLeave 统一处理离开导航区域 */}
      <div
        className="h-full flex-shrink-0"
        onMouseLeave={handleNavMouseLeave}
      >
        <ModuleRail
          modules={visibleModules}
          activeModuleId={activeModuleId}
          sidebarCollapsed={!isPinned}
          onModuleClick={handleModuleClick}
          onModuleHover={handleModuleHover}
          bottomItems={bottomNavItems}
          onBottomItemClick={handleBottomItemClick}
          activeTab={activeTab}
          username={username}
          onProfileClick={handleProfileClick}
          isProfileActive={activeTab === 'profile'}
          queueCounts={queueCounts}
          connectionStatus={connectionStatus}
          connectionTooltip={connectionTooltip}
        />
      </div>

      {/* 浮层模式：一体化动效 —— 从 hovered 图标位置展开，指示条跟随 */}
      <div
        className={`fixed top-0 left-14 h-screen w-[220px] z-40
          transition-[opacity,transform,box-shadow] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${isOverlayMode && displayModule
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
          }`}
        style={{
          transform: isOverlayMode && displayModule ? 'scaleX(1) translateX(0)' : 'scaleX(0.96) translateX(-6px)',
          transformOrigin: `left ${indicatorY}px`,
          boxShadow: isOverlayMode && displayModule
            ? '4px 0 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)'
            : 'none',
        }}
        onMouseEnter={handleNavMouseEnter}
        onMouseLeave={handleNavMouseLeave}
      >
        {/* 滑动指示条 —— 跟随 hovered 图标的 Y 位置 */}
        <div
          className="absolute left-0 z-10 rounded-r transition-all duration-200 ease-out"
          style={{
            top: `${indicatorY - 14}px`,
            height: '28px',
            width: '3px',
            backgroundColor: `rgb(${accentRgb})`,
            boxShadow: `0 0 8px rgba(${accentRgb}, 0.5)`,
            opacity: isOverlayMode && displayModule ? 1 : 0,
          }}
        />

        {/* 内部只在有模块时渲染内容 */}
        {(isOverlayMode || hoveredModuleId) && (displayModule || activeModule) && (
          <ContextSidebar
            module={(isOverlayMode ? displayModule : activeModule)!}
            activeTab={activeTab}
            isAdmin={isAdmin}
            onPageClick={handlePageClick}
            onCollapse={handleCollapse}
            onPin={handlePin}
            queueCounts={queueCounts}
            isOverlay={true}
          />
        )}
      </div>

      {/* 锁定模式：占据布局空间，带 transition 动画；鼠标移动时重置空闲计时 */}
      <div
        className={`transition-all duration-300 ease-out flex-shrink-0
          ${isPinned && displayModule
            ? 'w-[220px] opacity-100 overflow-hidden'
            : 'w-0 opacity-0 overflow-hidden'
          }`}
        onMouseMove={isPinned ? resetIdleTimer : undefined}
      >
        {isPinned && displayModule && (
          <ContextSidebar
            module={displayModule}
            activeTab={activeTab}
            isAdmin={isAdmin}
            onPageClick={handlePageClick}
            onCollapse={handleCollapse}
            queueCounts={queueCounts}
            isOverlay={false}
            idleCountdown={idleCountdown}
            autoCollapseEnabled={autoCollapseEnabled}
            collapseSeconds={collapseSeconds}
            onAutoCollapseEnabledChange={setAutoCollapseEnabled}
            onCollapseSecondsChange={setCollapseSeconds}
          />
        )}
      </div>

      {/* 小屏遮罩：锁定模式下小屏显示遮罩 */}
      {isSmallScreen && isPinned && (
        <div
          className="fixed inset-0 left-14 bg-black/40 backdrop-blur-sm z-30 transition-opacity duration-300"
          onClick={handleCollapse}
        />
      )}

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {children}
      </div>
    </div>
  );
};

export default AppShell;
