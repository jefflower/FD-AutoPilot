import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { X, Building2, Zap, ExternalLink } from 'lucide-react';
import type {
  AgentDefinition,
  AgentInstance,
  AgentExecutionLog,
  ClientRegistration,
} from '../types/server';
import { agentApi, clientApi } from '../services/api';
import { useServerEvent } from '../context/ServerEventsContext';

interface CyberOfficePopoverProps {
  onClose: () => void;
  onNavigateToOffice: () => void;
}

type DeskStatus = 'executing' | 'standby' | 'enabled' | 'disabled';

const getStatus = (
  def: AgentDefinition,
  instances: AgentInstance[],
  onlineClientIds: Set<string>,
  executingCount: number,
): DeskStatus => {
  if (executingCount > 0) return 'executing';
  const onlineRunning = instances.filter(i => i.running && onlineClientIds.has(i.clientId));
  if (onlineRunning.length > 0) return 'standby';
  if (def.enabled) return 'enabled';
  return 'disabled';
};

const statusConfig: Record<DeskStatus, { dot: string; label: string; textColor: string }> = {
  executing: { dot: 'bg-blue-400 animate-pulse', label: '\u5de5\u4f5c\u4e2d', textColor: 'text-blue-400' },
  standby:   { dot: 'bg-emerald-400 animate-pulse', label: '\u5f85\u547d\u4e2d', textColor: 'text-emerald-400' },
  enabled:   { dot: 'bg-yellow-400', label: '\u5df2\u542f\u7528', textColor: 'text-yellow-400' },
  disabled:  { dot: 'bg-slate-500', label: '\u672a\u542f\u7528', textColor: 'text-slate-500' },
};

const CyberOfficePopover: React.FC<CyberOfficePopoverProps> = ({
  onClose,
  onNavigateToOffice,
}) => {
  const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [onlineClients, setOnlineClients] = useState<ClientRegistration[]>([]);
  const [runningExecutions, setRunningExecutions] = useState<AgentExecutionLog[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [defs, insts, clients, running] = await Promise.all([
        agentApi.getAllDefinitions(),
        agentApi.getAllInstances(),
        clientApi.getOnlineClients(),
        agentApi.getRunningExecutions(),
      ]);
      setDefinitions(defs);
      setInstances(insts);
      setOnlineClients(clients);
      setRunningExecutions(running);
    } catch (e) {
      console.error('[CyberOfficePopover] loadData failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto refresh every 30s
  useEffect(() => {
    const timer = setInterval(loadData, 30_000);
    return () => clearInterval(timer);
  }, [loadData]);

  // SSE: instant refresh on execution events
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  useServerEvent('agent-execution-started', useCallback(() => {
    loadDataRef.current();
  }, []));

  useServerEvent('agent-execution-completed', useCallback(() => {
    loadDataRef.current();
  }, []));

  // Derived data
  const onlineClientIds = useMemo(
    () => new Set(onlineClients.filter(c => c.online).map(c => c.clientId)),
    [onlineClients],
  );

  /** Map: agentCode -> executing count */
  const executingCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const exec of runningExecutions) {
      map.set(exec.agentCode, (map.get(exec.agentCode) || 0) + 1);
    }
    return map;
  }, [runningExecutions]);

  /** Agent list with status */
  const agentList = useMemo(() => {
    return definitions
      .slice()
      .sort((a, b) => {
        const sa = getStatus(a, instances.filter(i => i.agentCode === a.code), onlineClientIds, executingCountMap.get(a.code) || 0);
        const sb = getStatus(b, instances.filter(i => i.agentCode === b.code), onlineClientIds, executingCountMap.get(b.code) || 0);
        const order: Record<DeskStatus, number> = { executing: 0, standby: 1, enabled: 2, disabled: 3 };
        return order[sa] - order[sb];
      })
      .map(def => {
        const agentInstances = instances.filter(i => i.agentCode === def.code);
        const execCount = executingCountMap.get(def.code) || 0;
        const status = getStatus(def, agentInstances, onlineClientIds, execCount);
        const execution = runningExecutions.find(e => e.agentCode === def.code);
        return { def, status, execCount, execution };
      });
  }, [definitions, instances, onlineClientIds, executingCountMap, runningExecutions]);

  // ─── Tick every second when there are running executions ───
  const [, setTick] = useState(0);
  useEffect(() => {
    if (runningExecutions.length === 0) return;
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [runningExecutions.length]);

  /** Summary counts */
  const summaryCounts = useMemo(() => {
    const counts = { executing: 0, standby: 0, enabled: 0, disabled: 0 };
    for (const item of agentList) {
      counts[item.status]++;
    }
    return counts;
  }, [agentList]);

  /** Execution elapsed time display */
  const getElapsedText = (exec: AgentExecutionLog): string => {
    if (!exec.createdAt) return '';
    const start = new Date(exec.createdAt).getTime();
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed < 60) return `${elapsed}s`;
    return `${Math.floor(elapsed / 60)}m${elapsed % 60}s`;
  };

  return (
    <div className="w-[400px] max-h-[520px] bg-slate-900 border border-slate-700/70 rounded-2xl shadow-2xl shadow-black/40 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-blue-400" />
          <span className="text-sm font-semibold text-white">{'\u8d5b\u535a\u529e\u516c\u5ba4'}</span>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-700/30 text-xs">
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400" />
          <span className="text-slate-300">{'\u5728\u7ebf'} {onlineClients.filter(c => c.online).length}</span>
        </span>
        <span className="text-slate-600">|</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-slate-300">{'\u5de5\u4f5c\u4e2d'} {summaryCounts.executing}</span>
        </span>
        <span className="text-slate-600">|</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-slate-300">{'\u5f85\u547d'} {summaryCounts.standby}</span>
        </span>
        <span className="text-slate-600">|</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-500" />
          <span className="text-slate-300">{'\u4f11\u606f'} {summaryCounts.disabled}</span>
        </span>
      </div>

      {/* Agent list (scrollable) */}
      <div className="flex-1 overflow-y-auto max-h-[380px] px-2 py-2 space-y-1">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-600 border-t-blue-400" />
          </div>
        ) : agentList.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-slate-500">
            {'\u6682\u65e0 Agent'}
          </div>
        ) : (
          agentList.map(({ def, status, execCount, execution }) => {
            const cfg = statusConfig[status];
            return (
              <div
                key={def.id}
                className={`rounded-lg px-3 py-2 transition-colors ${
                  status === 'executing'
                    ? 'bg-blue-500/8 border border-blue-500/20'
                    : 'hover:bg-slate-800/60'
                }`}
              >
                {/* First row: status dot + code + status label */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                    <span className="text-sm font-medium text-slate-200 truncate">{def.code}</span>
                  </div>
                  <span className={`text-xs font-medium ${cfg.textColor} flex-shrink-0 ml-2`}>
                    {cfg.label}
                  </span>
                </div>
                {/* Second row: execution info */}
                {status === 'executing' && execution && (
                  <div className="flex items-center gap-1.5 mt-1 ml-4 text-xs text-blue-400/80">
                    <Zap className="w-3 h-3" />
                    <span>
                      {'\u6b63\u5728\u5904\u7406\u4efb\u52a1'}
                      {execCount > 1 ? ` x${execCount}` : ''}
                      {execution.createdAt ? ` (${getElapsedText(execution)})` : ''}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer button */}
      <div className="px-4 py-3 border-t border-slate-700/50">
        <button
          onClick={onNavigateToOffice}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 text-sm font-medium hover:bg-blue-600/30 hover:border-blue-500/50 transition-all"
        >
          <ExternalLink className="w-4 h-4" />
          {'\u6253\u5f00\u8d5b\u535a\u529e\u516c\u5ba4'}
        </button>
      </div>
    </div>
  );
};

export default CyberOfficePopover;
