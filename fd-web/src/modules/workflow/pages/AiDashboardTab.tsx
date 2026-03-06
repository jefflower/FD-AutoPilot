import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, RefreshCw, Pause, Play } from 'lucide-react';
import { useAgentContext } from '../../../shared/agents/AgentContext';
import { useOfficeData } from '../../../shared/hooks/useOfficeData';
import { usePollingControl } from '../../../shared/hooks/usePollingControl';
import type { AgentDefinition } from '../../../shared/types/server';
import StatsBar from '../components/dashboard/StatsBar';
import ModuleAgentGrid from '../components/dashboard/ModuleAgentGrid';
import AgentLogDrawer from '../components/dashboard/AgentLogDrawer';
import StartupDetectBanner from '../components/dashboard/StartupDetectBanner';

const AiDashboardTab: React.FC = () => {
  const { t } = useTranslation('common');

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [logDrawerAgent, setLogDrawerAgent] = useState<string | null>(null);
  const { pollingPaused, setPollingPaused } = usePollingControl();

  const {
    definitions,
    instances,
    stats,
    onlineClients,
    onlineClientIds,
    runningExecutions,
    loading,
    lastUpdated,
    trueRunningOnlineCount,
    executingCount,
    overallStats,
    logRefreshTrigger,
    refresh,
  } = useOfficeData(autoRefresh ? 10000 : 0);

  // 手动启停 Agent（运行时状态，不修改数据库）+ 用户 Agent 配置
  const { toggleManualAgent, manualAgentOverrides, userAgentConfigs } = useAgentContext();

  // 过滤为用户已订阅的 Agent 列表
  const userDefinitions: AgentDefinition[] = useMemo(() => {
    if (userAgentConfigs.length === 0) return [];
    const subscribedCodes = new Set(userAgentConfigs.map(c => c.agentCode));
    return definitions.filter(d => subscribedCodes.has(d.code));
  }, [definitions, userAgentConfigs]);

  // Toggle Agent — 只改变运行时状态，不修改数据库的 enabled/autoStart
  const handleToggle = useCallback((id: number) => {
    const def = userDefinitions.find(d => d.id === id);
    if (!def) return;
    toggleManualAgent(def.code);
  }, [userDefinitions, toggleManualAgent]);

  // 找到当前 drawer 对应的 agent name
  const drawerAgentName = useMemo(() => {
    if (!logDrawerAgent) return undefined;
    return userDefinitions.find(d => d.code === logDrawerAgent)?.name;
  }, [logDrawerAgent, userDefinitions]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative">
      {/* Cyber grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-100"
        style={{
          backgroundImage: 'linear-gradient(rgba(6,182,212,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
        }}
      />
      {/* Scan line */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="w-full h-px bg-cyan-400/[0.04] cyber-ambient-scan" />
      </div>

      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white" style={{ textShadow: '0 0 10px rgba(96,165,250,0.3)' }}>
                {t('aiDashboard.cyberOffice', '赛博办公室')}
              </h1>
              {lastUpdated && (
                <p className="text-xs text-slate-500">
                  {t('aiDashboard.lastUpdated', { time: lastUpdated.toLocaleTimeString() })}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* 全局轮询开关 — 暂停 SSE + 所有定时轮询 */}
            <button
              onClick={() => setPollingPaused(!pollingPaused)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                pollingPaused
                  ? 'text-amber-300 bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/20'
                  : 'text-slate-400 bg-slate-700/30 border-slate-600/50 hover:bg-slate-700/50'
              }`}
            >
              {pollingPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {pollingPaused
                ? t('aiDashboard.resumePolling', '恢复轮询')
                : t('aiDashboard.pausePolling', '暂停轮询')}
            </button>
            {/* Auto Refresh Toggle */}
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <div
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`w-8 h-4 rounded-full transition-colors relative ${
                  autoRefresh ? 'bg-indigo-500' : 'bg-slate-600'
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all ${
                    autoRefresh ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </div>
              {t('aiDashboard.autoRefresh')}
            </label>
            <button
              onClick={refresh}
              className="px-3 py-1.5 text-xs text-slate-300 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t('aiDashboard.refresh')}
            </button>
          </div>
        </div>
        {/* Neon gradient separator */}
        <div className="h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-indigo-400" />
        </div>
      ) : (
        <>
          {/* 启动检测进度 */}
          <div className="flex-shrink-0 px-6 pt-3">
            <StartupDetectBanner />
          </div>

          {/* Stats Bar */}
          <div className="flex-shrink-0 px-6 py-3">
            <StatsBar
              onlineClients={onlineClients.length}
              totalAgents={userDefinitions.length}
              enabledAgents={userDefinitions.filter(d => d.enabled).length}
              runningOnlineAgents={trueRunningOnlineCount}
              executingTasks={executingCount}
              overallSuccessRate={overallStats.rate}
              totalExecutions={overallStats.total}
            />
          </div>

          {/* Agent 工位网格（滚动区域） */}
          <div className="flex-1 overflow-auto px-6 pb-4">
            <ModuleAgentGrid
              definitions={userDefinitions}
              instances={instances}
              stats={stats}
              onlineClientIds={onlineClientIds}
              onViewLogs={setLogDrawerAgent}
              onToggleAgent={handleToggle}
              runningExecutions={runningExecutions}
              manualAgentOverrides={manualAgentOverrides}
              userAgentConfigs={userAgentConfigs}
            />
          </div>
        </>
      )}

      {/* 日志抽屉 */}
      <AgentLogDrawer
        agentCode={logDrawerAgent}
        agentName={drawerAgentName}
        onClose={() => setLogDrawerAgent(null)}
        refreshTrigger={logRefreshTrigger}
      />
    </div>
  );
};

export default AiDashboardTab;
