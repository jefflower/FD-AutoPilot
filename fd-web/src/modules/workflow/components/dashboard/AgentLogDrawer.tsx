import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { AgentExecutionLog } from '../../../../shared/types/server';
import { agentApi } from '../../../../shared/services/api';
import EnhancedLogRow from './EnhancedLogRow';

interface AgentLogDrawerProps {
  agentCode: string | null;
  agentName?: string;
  onClose: () => void;
  refreshTrigger: number;
}

type StatusFilter = '' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';

const PAGE_SIZE = 20;

const AgentLogDrawer: React.FC<AgentLogDrawerProps> = ({
  agentCode,
  agentName,
  onClose,
  refreshTrigger,
}) => {
  const { t } = useTranslation('common');
  const isOpen = agentCode !== null;

  const [logs, setLogs] = useState<AgentExecutionLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const prevTriggerRef = useRef(refreshTrigger);

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    if (!agentCode) return;
    setLoading(true);
    try {
      const result = await agentApi.getExecutions({
        agentCode,
        status: statusFilter || undefined,
        page,
        size: PAGE_SIZE,
      });
      setLogs(result.content);
      setTotalPages(result.totalPages);
    } catch (e) {
      console.error('[AgentLogDrawer] fetchLogs failed:', e);
    } finally {
      setLoading(false);
    }
  }, [agentCode, statusFilter, page]);

  // Trigger fetch when params change
  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  // SSE 推送触发自动刷新
  useEffect(() => {
    if (refreshTrigger !== prevTriggerRef.current) {
      prevTriggerRef.current = refreshTrigger;
      if (isOpen) {
        fetchLogs();
      }
    }
  }, [refreshTrigger, isOpen, fetchLogs]);

  // Reset state when agent changes
  useEffect(() => {
    setPage(0);
    setStatusFilter('');
    setExpandedId(null);
  }, [agentCode]);

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleToggleExpand = (id: number) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  return (
    <>
      {/* 遮罩层 */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      {/* 面板 */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[480px] xl:w-[560px] bg-slate-900 border-l border-slate-700/50 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white truncate">
              {agentName || agentCode}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('aiDashboard.executionLog.title', '执行日志')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors ml-3"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter */}
        <div className="flex-shrink-0 px-5 py-3 border-b border-slate-700/30">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setPage(0);
            }}
            className="text-xs bg-slate-800 border border-slate-700/50 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500/50"
          >
            <option value="">{t('aiDashboard.executionLog.allStatus', '全部状态')}</option>
            <option value="RUNNING">RUNNING</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="FAILED">FAILED</option>
            <option value="TIMEOUT">TIMEOUT</option>
          </select>
        </div>

        {/* Log list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-600 border-t-indigo-400" />
            </div>
          )}

          {!loading && logs.length === 0 && (
            <div className="text-center text-slate-500 text-sm py-8">
              {t('aiDashboard.executionLog.noRecords', '暂无记录')}
            </div>
          )}

          {!loading && logs.map(log => (
            <EnhancedLogRow
              key={log.id}
              log={log}
              isExpanded={expandedId === log.id}
              onToggle={() => handleToggleExpand(log.id)}
            />
          ))}
        </div>

        {/* Pagination */}
        {!loading && logs.length > 0 && (
          <div className="flex-shrink-0 flex items-center justify-center gap-3 px-5 py-3 border-t border-slate-700/30">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-slate-500">
              {page + 1} / {Math.max(1, totalPages)}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default AgentLogDrawer;
