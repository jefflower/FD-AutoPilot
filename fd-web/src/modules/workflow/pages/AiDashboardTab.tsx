import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, RefreshCw } from 'lucide-react';
import { useAgentContext } from '../../../shared/agents/AgentContext';
import { useOfficeData } from '../../../shared/hooks/useOfficeData';
import StatsBar from '../components/dashboard/StatsBar';
import ModuleAgentGrid from '../components/dashboard/ModuleAgentGrid';
import AgentLogDrawer from '../components/dashboard/AgentLogDrawer';

const AiDashboardTab: React.FC = () => {
  const { t } = useTranslation('common');

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [logDrawerAgent, setLogDrawerAgent] = useState<string | null>(null);

  const {
    definitions,
    instances,
    stats,
    onlineClients,
    onlineClientIds,
    runningExecutions,
    loading,
    lastUpdated,
    enabledAgents,
    trueRunningOnlineCount,
    executingCount,
    overallStats,
    logRefreshTrigger,
    refresh,
  } = useOfficeData(autoRefresh ? 10000 : 0);

  // 手动启停 Agent（运行时状态，不修改数据库）
  const { toggleManualAgent, manualStartedAgents } = useAgentContext();

  // Toggle Agent — 只改变运行时状态，不修改数据库的 enabled/autoStart
  const handleToggle = useCallback((id: number) => {
    const def = definitions.find(d => d.id === id);
    if (!def) return;
    toggleManualAgent(def.code);
  }, [definitions, toggleManualAgent]);

  // 找到当前 drawer 对应的 agent name
  const drawerAgentName = useMemo(() => {
    if (!logDrawerAgent) return undefined;
    return definitions.find(d => d.code === logDrawerAgent)?.name;
  }, [logDrawerAgent, definitions]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-slate-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">
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
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-indigo-400" />
        </div>
      ) : (
        <>
          {/* Stats Bar */}
          <div className="flex-shrink-0 px-6 py-3">
            <StatsBar
              onlineClients={onlineClients.length}
              totalAgents={definitions.length}
              enabledAgents={enabledAgents}
              runningOnlineAgents={trueRunningOnlineCount}
              executingTasks={executingCount}
              overallSuccessRate={overallStats.rate}
              totalExecutions={overallStats.total}
            />
          </div>

          {/* Agent 工位网格（滚动区域） */}
          <div className="flex-1 overflow-auto px-6 pb-4">
            <ModuleAgentGrid
              definitions={definitions}
              instances={instances}
              stats={stats}
              onlineClientIds={onlineClientIds}
              onViewLogs={setLogDrawerAgent}
              onToggleAgent={handleToggle}
              runningExecutions={runningExecutions}
              manualStartedAgents={manualStartedAgents}
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
