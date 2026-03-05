import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Circle, Power, AlertCircle } from 'lucide-react';
import type { AgentDefinition, AgentInstance, AgentStats, AgentExecutionLog } from '../../../../shared/types/server';

interface DeskCardProps {
  definition: AgentDefinition;
  instances: AgentInstance[];
  onlineClientIds: Set<string>;
  stats?: AgentStats;
  executingCount: number;
  currentExecution?: AgentExecutionLog;
  onToggle: (id: number) => void;
  onClick: () => void;
  compact?: boolean;
}

type DeskStatus = 'executing' | 'standby' | 'enabled' | 'disabled';

function getDeskStatus(
  definition: AgentDefinition,
  instances: AgentInstance[],
  onlineClientIds: Set<string>,
  executingCount: number,
): DeskStatus {
  if (executingCount > 0) return 'executing';
  const hasRunningOnline = instances.some(i => i.running && onlineClientIds.has(i.clientId));
  if (hasRunningOnline) return 'standby';
  if (definition.enabled) return 'enabled';
  return 'disabled';
}

function formatElapsed(createdAt: string): string {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  if (elapsed < 1000) return '<1s';
  if (elapsed < 60000) return `${Math.floor(elapsed / 1000)}s`;
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m${Math.floor((elapsed % 60000) / 1000)}s`;
  return `${Math.floor(elapsed / 3600000)}h${Math.floor((elapsed % 3600000) / 60000)}m`;
}

const statusConfig: Record<DeskStatus, {
  dot: string;
  border: string;
  bg: string;
  label: string;
  labelKey: string;
  tagBg: string;
  tagText: string;
}> = {
  executing: {
    dot: 'bg-blue-400 animate-pulse',
    border: 'border-blue-500/60 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/20',
    bg: 'bg-slate-800/90',
    label: '工作中',
    labelKey: 'aiDashboard.deskCard.executing',
    tagBg: 'bg-blue-500/15',
    tagText: 'text-blue-400',
  },
  standby: {
    dot: 'bg-emerald-400',
    border: 'border-emerald-500/40',
    bg: 'bg-slate-800/70',
    label: '待命中',
    labelKey: 'aiDashboard.deskCard.standby',
    tagBg: 'bg-emerald-500/15',
    tagText: 'text-emerald-400',
  },
  enabled: {
    dot: 'bg-yellow-400',
    border: 'border-slate-700/50',
    bg: 'bg-slate-800/50',
    label: '已启用',
    labelKey: 'aiDashboard.deskCard.enabled',
    tagBg: 'bg-yellow-500/15',
    tagText: 'text-yellow-400',
  },
  disabled: {
    dot: 'bg-slate-500',
    border: 'border-slate-700/30',
    bg: 'bg-slate-800/30 opacity-60',
    label: '未启用',
    labelKey: 'aiDashboard.deskCard.disabled',
    tagBg: 'bg-slate-500/15',
    tagText: 'text-slate-500',
  },
};

const DeskCard: React.FC<DeskCardProps> = ({
  definition,
  instances,
  onlineClientIds,
  stats,
  executingCount,
  currentExecution,
  onToggle,
  onClick,
  compact = false,
}) => {
  const { t } = useTranslation('common');

  const status = useMemo(
    () => getDeskStatus(definition, instances, onlineClientIds, executingCount),
    [definition, instances, onlineClientIds, executingCount],
  );
  const config = statusConfig[status];

  const successRate = stats?.successRate ?? 0;
  const totalExec = stats?.totalExecutions ?? 0;
  const avgMs = stats?.avgDurationMs ?? 0;

  const barColor = successRate > 80
    ? 'bg-emerald-500'
    : successRate > 60
      ? 'bg-amber-500'
      : 'bg-red-500';

  const capability = definition.requiredCapability || definition.capability || '-';

  // compact 模式（浮窗用）
  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`rounded-lg border p-3 cursor-pointer transition-all ${config.border} ${config.bg} hover:border-slate-600/60`}
      >
        {/* Row 1: 状态灯 + code + 状态标签 */}
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`} />
          <span className="text-xs font-medium text-white truncate flex-1">{definition.code}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${config.tagBg} ${config.tagText}`}>
            {t(config.labelKey, config.label)}
          </span>
        </div>
        {/* Row 2: name */}
        <div className="text-xs text-slate-400 truncate mb-1">{definition.name}</div>
        {/* Row 3: 工作状态 */}
        {status === 'executing' && currentExecution ? (
          <div className="flex items-center gap-1 text-xs text-blue-400">
            <Zap className="w-3 h-3 animate-pulse" />
            <span className="truncate">
              {t('aiDashboard.deskCard.processing', '正在处理任务')} ({formatElapsed(currentExecution.createdAt)})
            </span>
          </div>
        ) : (
          <div className="text-xs text-slate-500">
            {t(config.labelKey, config.label)}
          </div>
        )}
      </div>
    );
  }

  // 普通模式
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border p-4 cursor-pointer transition-all relative overflow-hidden ${config.border} ${config.bg} hover:border-slate-600/50`}
    >
      {/* 执行中动画背景 */}
      {status === 'executing' && (
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-blue-500/10 to-blue-500/5 animate-pulse pointer-events-none" />
      )}

      {/* Header: 状态灯 + code + 启停开关 */}
      <div className="flex items-center justify-between mb-1 relative">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`} />
          <span className="text-sm font-medium text-white truncate">{definition.code}</span>
        </div>
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggle(definition.id);
          }}
          className={`w-8 h-4 rounded-full transition-colors cursor-pointer flex-shrink-0 relative ${
            definition.enabled ? 'bg-indigo-500' : 'bg-slate-600'
          }`}
        >
          <div
            className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all ${
              definition.enabled ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        </div>
      </div>

      {/* Name */}
      <div className="text-xs text-slate-400 mb-1 truncate relative">{definition.name}</div>

      {/* Capability */}
      <div className="text-xs text-slate-500 mb-2 relative">
        {t('aiDashboard.agentCard.capability', '能力')}: {capability}
      </div>

      {/* 工作状态区 */}
      <div className={`flex items-center gap-1.5 mb-2 px-2 py-1.5 rounded-lg text-xs font-medium relative ${config.tagBg} ${config.tagText}`}>
        {status === 'executing' ? (
          <>
            <Zap className="w-3 h-3 animate-pulse" />
            {currentExecution ? (
              <span className="truncate">
                {t('aiDashboard.deskCard.processing', '正在处理任务')} ({formatElapsed(currentExecution.createdAt)})
              </span>
            ) : (
              <span>{t('aiDashboard.agentCard.executing', { count: executingCount })}</span>
            )}
          </>
        ) : status === 'standby' ? (
          <>
            <Circle className="w-3 h-3" />
            <span>{t('aiDashboard.deskCard.standby', '待命中')}</span>
          </>
        ) : status === 'enabled' ? (
          <>
            <Power className="w-3 h-3" />
            <span>{t('aiDashboard.deskCard.enabled', '已启用')}</span>
          </>
        ) : (
          <>
            <AlertCircle className="w-3 h-3" />
            <span>{t('aiDashboard.deskCard.disabled', '未启用')}</span>
          </>
        )}
      </div>

      {/* 执行统计 + 成功率进度条 */}
      {totalExec > 0 && (
        <div className="relative">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>
              {t('aiDashboard.executionLog.execCount', '执行 {{count}} 次', { count: totalExec })}
            </span>
            <span className="text-slate-600">|</span>
            <span>
              {t('aiDashboard.deskCard.successRate', '成功率 {{rate}}%', { rate: Math.round(successRate) })}
            </span>
            <span className="text-slate-600">|</span>
            <span>
              {t('aiDashboard.deskCard.avgDuration', '均 {{duration}}', { duration: avgMs < 1000 ? `${Math.round(avgMs)}ms` : `${(avgMs / 1000).toFixed(1)}s` })}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-700">
            <div
              className={`h-1.5 rounded-full ${barColor} transition-all`}
              style={{ width: `${Math.min(100, successRate)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default DeskCard;
