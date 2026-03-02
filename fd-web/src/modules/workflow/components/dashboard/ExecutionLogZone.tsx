import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, AlertTriangle, Maximize2, X } from 'lucide-react';
import type { AgentDefinition, AgentExecutionLog, AgentExecutionStatus } from '../../../../shared/types/server';
import { agentApi } from '../../../../shared/services/api';
import { execLogApi, type ExecLogEntry } from '../../../../shared/services/execLogApi';
import EnhancedLogRow from './EnhancedLogRow';

interface ExecutionLogZoneProps {
  definitions: AgentDefinition[];
  selectedAgent: string | null;
  onAgentFilterChange?: (code: string | null) => void;
}

type TabKey = 'server' | 'local';
type StatusFilter = '' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';

const PAGE_SIZE = 20;

/** Map local ExecLogEntry to AgentExecutionLog-like shape for EnhancedLogRow */
function mapLocalToLog(entry: ExecLogEntry): AgentExecutionLog {
  const statusMap: Record<string, AgentExecutionStatus> = {
    running: 'RUNNING',
    success: 'SUCCESS',
    failed: 'FAILED',
    timeout: 'TIMEOUT',
  };
  return {
    id: entry.id,
    agentCode: entry.agentCode,
    status: statusMap[entry.status] || 'FAILED',
    durationMs: entry.durationMs ?? undefined,
    inputSnapshot: entry.inputParams || entry.command || undefined,
    outputSnapshot: entry.stdout || undefined,
    errorMessage: entry.errorMsg || entry.stderr || undefined,
    createdAt: entry.createdAt,
  };
}

const ExecutionLogZone: React.FC<ExecutionLogZoneProps> = ({
  definitions,
  selectedAgent,
  onAgentFilterChange,
}) => {
  const { t } = useTranslation('common');

  const [activeTab, setActiveTab] = useState<TabKey>('server');
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Server records state
  const [serverLogs, setServerLogs] = useState<AgentExecutionLog[]>([]);
  const [serverPage, setServerPage] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(0);
  const [serverLoading, setServerLoading] = useState(false);

  // Local logs state
  const [localLogs, setLocalLogs] = useState<AgentExecutionLog[]>([]);
  const [localOffset, setLocalOffset] = useState(0);
  const [localTotal, setLocalTotal] = useState(0);
  const [localLoading, setLocalLoading] = useState(false);
  const [bridgeAvailable, setBridgeAvailable] = useState<boolean | null>(null);

  // Sync selectedAgent to agentFilter
  useEffect(() => {
    setAgentFilter(selectedAgent || '');
  }, [selectedAgent]);

  // Fetch server logs
  const fetchServerLogs = useCallback(async () => {
    setServerLoading(true);
    try {
      const result = await agentApi.getExecutions({
        agentCode: agentFilter || undefined,
        page: serverPage,
        size: PAGE_SIZE,
      });
      setServerLogs(result.content);
      setServerTotalPages(result.totalPages);
    } catch (e) {
      console.error('[ExecutionLogZone] fetchServerLogs failed:', e);
    } finally {
      setServerLoading(false);
    }
  }, [agentFilter, serverPage]);

  // Fetch local logs
  const fetchLocalLogs = useCallback(async () => {
    if (bridgeAvailable === false) return;
    setLocalLoading(true);
    try {
      const available = await execLogApi.checkAvailable();
      setBridgeAvailable(available);
      if (!available) {
        setLocalLoading(false);
        return;
      }
      const result = await execLogApi.query(agentFilter || '', {
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        offset: localOffset,
      });
      setLocalLogs(result.items.map(mapLocalToLog));
      setLocalTotal(result.total);
    } catch (e) {
      console.error('[ExecutionLogZone] fetchLocalLogs failed:', e);
    } finally {
      setLocalLoading(false);
    }
  }, [agentFilter, statusFilter, localOffset, bridgeAvailable]);

  // Trigger fetches
  useEffect(() => {
    if (activeTab === 'server') {
      fetchServerLogs();
    }
  }, [activeTab, fetchServerLogs]);

  useEffect(() => {
    if (activeTab === 'local') {
      fetchLocalLogs();
    }
  }, [activeTab, fetchLocalLogs]);

  // Reset pagination when filter changes
  useEffect(() => {
    setServerPage(0);
    setLocalOffset(0);
    setExpandedId(null);
  }, [agentFilter, statusFilter]);

  // Close fullscreen on Escape
  useEffect(() => {
    if (!fullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [fullscreen]);

  const handleAgentFilterChange = (code: string) => {
    setAgentFilter(code);
    onAgentFilterChange?.(code || null);
  };

  const handleToggleExpand = (id: number) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  const currentLogs = activeTab === 'server' ? serverLogs : localLogs;
  const isLoading = activeTab === 'server' ? serverLoading : localLoading;

  /** Shared content renderer (used both inline and in fullscreen modal) */
  const renderLogContent = (isModal: boolean) => (
    <>
      {/* Header: Tabs + Filters */}
      <div className={`flex-shrink-0 flex items-center justify-between gap-4 pb-3 border-b border-slate-700/30 ${isModal ? 'px-6 pt-4' : ''}`}>
        {/* Left: Tabs */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveTab('server')}
            className={`text-sm pb-1 transition-colors ${
              activeTab === 'server'
                ? 'border-b-2 border-indigo-500 text-indigo-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            {t('aiDashboard.executionLog.serverRecords')}
          </button>
          <button
            onClick={() => setActiveTab('local')}
            className={`text-sm pb-1 transition-colors ${
              activeTab === 'local'
                ? 'border-b-2 border-indigo-500 text-indigo-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            {t('aiDashboard.executionLog.localLogs')}
          </button>
        </div>

        {/* Right: Filters + Fullscreen button */}
        <div className="flex items-center gap-2">
          <select
            value={agentFilter}
            onChange={(e) => handleAgentFilterChange(e.target.value)}
            className="text-xs bg-slate-800 border border-slate-700/50 text-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500/50"
          >
            <option value="">{t('aiDashboard.executionLog.allAgents')}</option>
            {definitions.map(d => (
              <option key={d.code} value={d.code}>{d.code}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="text-xs bg-slate-800 border border-slate-700/50 text-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500/50"
          >
            <option value="">{t('aiDashboard.executionLog.allStatus')}</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="FAILED">FAILED</option>
            <option value="TIMEOUT">TIMEOUT</option>
          </select>
          {isModal ? (
            <button
              onClick={() => setFullscreen(false)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
              title={t('button.close')}
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => setFullscreen(true)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
              title={t('aiDashboard.executionLog.fullscreen')}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Log list */}
      <div className={`flex-1 overflow-y-auto ${isModal ? 'px-6' : ''}`}>
        {/* Bridge unavailable warning for local tab */}
        {activeTab === 'local' && bridgeAvailable === false && (
          <div className="flex items-center gap-2 p-4 text-sm text-amber-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {t('aiDashboard.executionLog.bridgeUnavailable')}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-600 border-t-indigo-400" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && currentLogs.length === 0 && !(activeTab === 'local' && bridgeAvailable === false) && (
          <div className="text-center text-slate-500 text-sm py-8">
            {t('aiDashboard.executionLog.noRecords')}
          </div>
        )}

        {/* Log rows */}
        {!isLoading && currentLogs.map(log => (
          <EnhancedLogRow
            key={log.id}
            log={log}
            isExpanded={expandedId === log.id}
            onToggle={() => handleToggleExpand(log.id)}
          />
        ))}
      </div>

      {/* Pagination */}
      {!isLoading && currentLogs.length > 0 && (
        <div className={`flex-shrink-0 flex items-center justify-center gap-3 pt-2 border-t border-slate-700/30 ${isModal ? 'px-6 pb-4' : ''}`}>
          {activeTab === 'server' ? (
            <>
              <button
                onClick={() => setServerPage(p => Math.max(0, p - 1))}
                disabled={serverPage === 0}
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-slate-500">
                {serverPage + 1} / {Math.max(1, serverTotalPages)}
              </span>
              <button
                onClick={() => setServerPage(p => Math.min(serverTotalPages - 1, p + 1))}
                disabled={serverPage >= serverTotalPages - 1}
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setLocalOffset(o => Math.max(0, o - PAGE_SIZE))}
                disabled={localOffset === 0}
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-slate-500">
                {Math.floor(localOffset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(localTotal / PAGE_SIZE))}
              </span>
              <button
                onClick={() => setLocalOffset(o => o + PAGE_SIZE)}
                disabled={localOffset + PAGE_SIZE >= localTotal}
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Inline (embedded in split pane) */}
      <div className="flex-1 flex flex-col overflow-hidden h-full">
        {renderLogContent(false)}
      </div>

      {/* Fullscreen Modal */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setFullscreen(false); }}
        >
          <div className="w-[95vw] h-[92vh] bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal title bar */}
            <div className="flex-shrink-0 flex items-center gap-3 px-6 pt-5 pb-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                <Maximize2 className="w-4 h-4 text-indigo-400" />
              </div>
              <h2 className="text-base font-semibold text-white">{t('aiDashboard.executionLog.title')}</h2>
            </div>
            {renderLogContent(true)}
          </div>
        </div>
      )}
    </>
  );
};

export default ExecutionLogZone;
