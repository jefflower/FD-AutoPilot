import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, ExternalLink, Upload, Check, Loader2 } from 'lucide-react';
import { useJsonPreview } from '../../../../shared/components/JsonPreview';
import type { AgentExecutionLog } from '../../../../shared/types/server';

interface EnhancedLogRowProps {
  log: AgentExecutionLog;
  isExpanded: boolean;
  onToggle: () => void;
  /** 是否为本地日志（显示上报按钮） */
  isLocal?: boolean;
  /** 上报回调 */
  onReport?: (log: AgentExecutionLog) => Promise<void>;
}

function tryFormatJson(str: string | null | undefined): string {
  if (!str) return '';
  try {
    const parsed = JSON.parse(str);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return str;
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

const statusConfig: Record<string, { dot: string; badge: string; label: string }> = {
  SUCCESS: { dot: 'bg-emerald-400', badge: 'bg-emerald-500/20 text-emerald-400', label: 'SUCCESS' },
  FAILED: { dot: 'bg-red-400', badge: 'bg-red-500/20 text-red-400', label: 'FAILED' },
  RUNNING: { dot: 'bg-blue-400 animate-pulse', badge: 'bg-blue-500/20 text-blue-400', label: 'RUNNING' },
  TIMEOUT: { dot: 'bg-amber-400', badge: 'bg-amber-500/20 text-amber-400', label: 'TIMEOUT' },
  CANCELLED: { dot: 'bg-slate-400', badge: 'bg-slate-500/20 text-slate-400', label: 'CANCELLED' },
};

const EnhancedLogRow: React.FC<EnhancedLogRowProps> = ({ log, isExpanded, onToggle, isLocal, onReport }) => {
  const { t } = useTranslation('common');
  const { openPreview } = useJsonPreview();
  const config = statusConfig[log.status] || statusConfig.CANCELLED;

  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  const handleReport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (reporting || reported || !onReport) return;
    setReporting(true);
    try {
      await onReport(log);
      setReported(true);
    } catch {
      // error handled by parent
    } finally {
      setReporting(false);
    }
  };

  return (
    <div className="border-b border-slate-700/30">
      {/* Collapsed row */}
      <div
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-700/20 transition-colors"
      >
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dot}`} />
        <span className="text-xs font-medium text-white truncate max-w-[140px] flex-shrink-0">{log.agentCode}</span>
        <span className="text-[11px] text-slate-500 flex-shrink-0 tabular-nums">{formatTime(log.createdAt)}</span>
        <span className="text-[11px] text-slate-400 flex-shrink-0 tabular-nums w-[48px] text-right">{formatDuration(log.durationMs)}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${config.badge}`}>{config.label}</span>
        <div className="flex-1 min-w-0" />
        {/* 本地日志上报按钮（仅图标 + tooltip） */}
        {isLocal && onReport && (
          <button
            onClick={handleReport}
            disabled={reporting || reported}
            className={`flex-shrink-0 p-1 rounded transition-colors ${
              reported
                ? 'text-emerald-400 bg-emerald-500/10'
                : reporting
                ? 'text-slate-400 cursor-wait'
                : 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/10'
            }`}
            title={reported ? t('aiDashboard.executionLog.reportSuccess') : t('aiDashboard.executionLog.reportToServer')}
          >
            {reported ? (
              <Check className="w-3.5 h-3.5" />
            ) : reporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        <button className="flex-shrink-0 text-slate-400 hover:text-white transition-colors p-0.5">
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-4 pb-4 bg-slate-800/30">
          {/* Info grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-3 pt-2">
            <InfoItem label={t('aiDashboard.executionLog.agent')} value={log.agentCode} />
            <InfoItem label={t('aiDashboard.executionLog.status')} value={log.status} />
            <InfoItem label={t('aiDashboard.executionLog.time')} value={formatTime(log.createdAt)} />
            <InfoItem label={t('aiDashboard.executionLog.duration')} value={formatDuration(log.durationMs)} />
            <InfoItem label={t('aiDashboard.executionLog.tokens')} value={log.tokenCount != null ? String(log.tokenCount) : '-'} />
            <InfoItem
              label={`${t('aiDashboard.executionLog.referenceType')} / ${t('aiDashboard.executionLog.referenceId')}`}
              value={log.referenceType ? `${log.referenceType} #${log.referenceId ?? '-'}` : '-'}
            />
          </div>

          {/* Input section */}
          {log.inputSnapshot && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-slate-400">
                  {t('aiDashboard.executionLog.input')}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openPreview({ title: `${log.agentCode} - Input`, json: log.inputSnapshot! });
                  }}
                  className="text-[10px] text-slate-500 hover:text-blue-400 transition-colors flex items-center gap-0.5"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  {t('jsonPreview.openInWindow')}
                </button>
              </div>
              <pre className="bg-slate-900/50 rounded-lg p-3 text-xs font-mono text-slate-300 max-h-[500px] overflow-y-auto whitespace-pre-wrap break-all">
                {tryFormatJson(log.inputSnapshot)}
              </pre>
            </div>
          )}

          {/* Output section */}
          {log.outputSnapshot && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-slate-400">
                  {t('aiDashboard.executionLog.output')}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openPreview({ title: `${log.agentCode} - Output`, json: log.outputSnapshot! });
                  }}
                  className="text-[10px] text-slate-500 hover:text-blue-400 transition-colors flex items-center gap-0.5"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  {t('jsonPreview.openInWindow')}
                </button>
              </div>
              <pre className="bg-slate-900/50 rounded-lg p-3 text-xs font-mono text-slate-300 max-h-[500px] overflow-y-auto whitespace-pre-wrap break-all">
                {tryFormatJson(log.outputSnapshot)}
              </pre>
            </div>
          )}

          {/* Error section */}
          {log.errorMessage && (
            <div>
              <div className="text-xs text-red-400 mb-1">{t('aiDashboard.executionLog.errorMsg')}</div>
              <pre className="bg-red-900/20 border border-red-800/30 rounded-lg p-3 text-xs font-mono text-red-300 max-h-[500px] overflow-y-auto whitespace-pre-wrap break-all">
                {log.errorMessage}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const InfoItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-xs text-slate-500">{label}</div>
    <div className="text-xs text-slate-300 truncate">{value}</div>
  </div>
);

export default EnhancedLogRow;
