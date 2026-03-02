import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, RefreshCw } from 'lucide-react';
import type {
  AgentDefinition,
  AgentInstance,
  AgentStats,
  ClientRegistration,
} from '../../../shared/types/server';
import { agentApi, clientApi } from '../../../shared/services/api';
import StatsBar from '../components/dashboard/StatsBar';
import ModuleAgentGrid from '../components/dashboard/ModuleAgentGrid';
import ExecutionLogZone from '../components/dashboard/ExecutionLogZone';
import ResizableSplitPane from '../components/dashboard/ResizableSplitPane';

const AiDashboardTab: React.FC = () => {
  const { t } = useTranslation('common');

  // State
  const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [stats, setStats] = useState<AgentStats[]>([]);
  const [onlineClients, setOnlineClients] = useState<ClientRegistration[]>([]);
  const [syncBridgeStatus, setSyncBridgeStatus] = useState<{ activeWaiting: number }>({ activeWaiting: 0 });
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Data loading
  const loadData = useCallback(async () => {
    try {
      const [defs, insts, sts, clients, bridge] = await Promise.all([
        agentApi.getAllDefinitions(),
        agentApi.getAllInstances(),
        agentApi.getStats(),
        clientApi.getOnlineClients(),
        agentApi.getSyncBridgeStatus(),
      ]);
      setDefinitions(defs);
      setInstances(insts);
      setStats(sts);
      setOnlineClients(clients);
      setSyncBridgeStatus(bridge);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('[AiDashboard] loadData failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto refresh 10s
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(loadData, 10000);
    return () => clearInterval(timer);
  }, [autoRefresh, loadData]);

  // Toggle Agent
  const handleToggle = useCallback(async (id: number) => {
    await agentApi.toggleDefinition(id);
    loadData();
  }, [loadData]);

  // Computed stats
  const enabledAgents = definitions.filter(d => d.enabled).length;
  const runningInstances = instances.filter(i => i.running).length;
  const onlineClientIds = useMemo(
    () => new Set(onlineClients.map(c => c.clientId)),
    [onlineClients],
  );

  const overallStats = useMemo(() => {
    if (stats.length === 0) return { rate: 0, total: 0, avgMs: 0 };
    const totalExec = stats.reduce((s, st) => s + st.totalExecutions, 0);
    const totalSuccess = stats.reduce((s, st) => s + st.successCount, 0);
    const avgMs = totalExec > 0
      ? Math.round(stats.reduce((s, st) => s + st.avgDurationMs * st.totalExecutions, 0) / totalExec)
      : 0;
    return {
      rate: totalExec > 0 ? Math.round((totalSuccess / totalExec) * 100) : 0,
      total: totalExec,
      avgMs,
    };
  }, [stats]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-slate-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">{t('aiDashboard.title')}</h1>
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
              onClick={loadData}
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
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Stats Bar */}
          <div className="flex-shrink-0 px-6 py-4">
            <StatsBar
              onlineClients={onlineClients.length}
              totalAgents={definitions.length}
              enabledAgents={enabledAgents}
              runningInstances={runningInstances}
              totalInstances={instances.length}
              syncBridgeWaiting={syncBridgeStatus.activeWaiting}
              overallSuccessRate={overallStats.rate}
              totalExecutions={overallStats.total}
              avgDurationMs={overallStats.avgMs}
            />
          </div>

          {/* Resizable Split: Agent Grid + Execution Log */}
          <div className="flex-1 overflow-hidden px-6 pb-4">
            <ResizableSplitPane
              defaultRatio={0.4}
              topContent={
                <ModuleAgentGrid
                  definitions={definitions}
                  instances={instances}
                  stats={stats}
                  onlineClientIds={onlineClientIds}
                  selectedAgent={selectedAgent}
                  onSelectAgent={setSelectedAgent}
                  onToggleAgent={handleToggle}
                />
              }
              bottomContent={
                <ExecutionLogZone
                  definitions={definitions}
                  selectedAgent={selectedAgent}
                  onAgentFilterChange={setSelectedAgent}
                />
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default AiDashboardTab;
