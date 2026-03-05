import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { agentApi, clientApi } from '../services/api';
import { useServerEvent } from '../context/ServerEventsContext';
import type {
  AgentDefinition,
  AgentInstance,
  AgentStats,
  AgentExecutionLog,
  ClientRegistration,
} from '../types/server';

export interface OfficeData {
  definitions: AgentDefinition[];
  instances: AgentInstance[];
  stats: AgentStats[];
  onlineClients: ClientRegistration[];
  onlineClientIds: Set<string>;
  runningExecutions: AgentExecutionLog[];
  loading: boolean;
  lastUpdated: Date | null;
  // 计算属性
  enabledAgents: number;
  trueRunningOnlineCount: number;
  executingCount: number;
  overallStats: { rate: number; total: number; avgMs: number };
  // SSE 日志刷新触发器
  logRefreshTrigger: number;
  // 方法
  refresh: () => Promise<void>;
}

export function useOfficeData(autoRefreshInterval = 10000): OfficeData {
  const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [stats, setStats] = useState<AgentStats[]>([]);
  const [onlineClients, setOnlineClients] = useState<ClientRegistration[]>([]);
  const [runningExecutions, setRunningExecutions] = useState<AgentExecutionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [logRefreshTrigger, setLogRefreshTrigger] = useState(0);

  const loadData = useCallback(async () => {
    try {
      const [defs, insts, sts, clients] = await Promise.all([
        agentApi.getAllDefinitions(),
        agentApi.getAllInstances(),
        agentApi.getStats(),
        clientApi.getOnlineClients(),
      ]);
      setDefinitions(defs);
      setInstances(insts);
      setStats(sts);
      setOnlineClients(clients);
      setLastUpdated(new Date());

      // 单独获取 running，失败时不影响主数据
      try {
        const running = await agentApi.getRunningExecutions();
        setRunningExecutions(running);
      } catch {
        // running 查询失败不影响主数据
      }
    } catch (e) {
      console.error('[useOfficeData] loadData failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto refresh
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const timer = setInterval(loadData, autoRefreshInterval);
    return () => clearInterval(timer);
  }, [autoRefreshInterval, loadData]);

  // SSE: 监听执行开始/完成事件 — 立即刷新
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  useServerEvent('agent-execution-started', useCallback(() => {
    loadDataRef.current();
    setLogRefreshTrigger(c => c + 1);
  }, []));

  useServerEvent('agent-execution-completed', useCallback(() => {
    loadDataRef.current();
    setLogRefreshTrigger(c => c + 1);
  }, []));

  // 计算属性
  const onlineClientIds = useMemo(
    () => new Set(onlineClients.map(c => c.clientId)),
    [onlineClients],
  );

  const enabledAgents = useMemo(
    () => definitions.filter(d => d.enabled).length,
    [definitions],
  );

  // 真正在线运行的实例数：running=true 且客户端在线
  const trueRunningOnlineCount = useMemo(
    () => instances.filter(i => i.running && onlineClientIds.has(i.clientId)).length,
    [instances, onlineClientIds],
  );

  const executingCount = runningExecutions.length;

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

  return {
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
    refresh: loadData,
  };
}
