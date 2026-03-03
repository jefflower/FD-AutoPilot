import React from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import type { AgentDefinition, AgentInstance, AgentStats } from '../../../../shared/types/server';

interface AgentStatusCardProps {
  definition: AgentDefinition;
  instances: AgentInstance[];
  onlineClientIds: Set<string>;
  stats?: AgentStats;
  isSelected: boolean;
  onSelect: (code: string) => void;
  onToggle: (id: number) => void;
  /** 当前正在执行中的任务数 */
  executingCount?: number;
}

const AgentStatusCard: React.FC<AgentStatusCardProps> = ({
  definition,
  instances,
  onlineClientIds,
  stats,
  isSelected,
  onSelect,
  onToggle,
  executingCount = 0,
}) => {
  const { t } = useTranslation('common');

  const onlineInstances = instances.filter(i => onlineClientIds.has(i.clientId));
  const runningInstances = instances.filter(i => i.running);

  // 是否正在执行任务
  const isExecuting = executingCount > 0;

  // Status light: executing=blue pulse, running=green pulse, enabled=yellow, disabled=red
  const statusDotClass = isExecuting
    ? 'bg-blue-400 animate-pulse'
    : runningInstances.length > 0
      ? 'bg-emerald-400 animate-pulse'
      : definition.enabled
        ? 'bg-yellow-400'
        : 'bg-red-400';

  const successRate = stats?.successRate ?? 0;
  const totalExec = stats?.totalExecutions ?? 0;
  const avgMs = stats?.avgDurationMs ?? 0;

  const barColor = successRate > 80
    ? 'bg-emerald-500'
    : successRate > 60
      ? 'bg-amber-500'
      : 'bg-red-500';

  return (
    <div
      onClick={() => onSelect(definition.code)}
      className={`rounded-xl border p-4 cursor-pointer transition-all relative overflow-hidden ${
        isExecuting
          ? 'border-blue-500/60 bg-slate-800/90 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/20'
          : isSelected
            ? 'border-indigo-500/50 bg-slate-800/80 shadow-lg shadow-indigo-500/5'
            : 'border-slate-700/50 bg-slate-800/50 hover:border-slate-600/50'
      }`}
    >
      {/* 执行中动画背景 */}
      {isExecuting && (
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-blue-500/10 to-blue-500/5 animate-pulse pointer-events-none" />
      )}

      {/* Header row */}
      <div className="flex items-center justify-between mb-1 relative">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass}`} />
          <span className="text-sm font-medium text-white truncate">{definition.code}</span>
        </div>
        {/* Toggle switch */}
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
        {t('aiDashboard.agentCard.capability')}: {definition.capability || definition.requiredCapability || '-'}
      </div>

      {/* 工作状态指示器 — 明显区分工作/空闲 */}
      <div className={`flex items-center gap-1.5 mb-2 px-2 py-1 rounded-lg text-xs font-medium relative ${
        isExecuting
          ? 'bg-blue-500/15 text-blue-400'
          : 'bg-slate-700/30 text-slate-500'
      }`}>
        {isExecuting ? (
          <>
            <Zap className="w-3 h-3 animate-pulse" />
            <span>{t('aiDashboard.agentCard.executing', { count: executingCount })}</span>
          </>
        ) : (
          <span>{t('aiDashboard.agentCard.idle')}</span>
        )}
      </div>

      {/* Instance info */}
      <div className="text-xs text-slate-400 mb-2 relative">
        {instances.length > 0 ? (
          <>
            {t('aiDashboard.agentCard.instances')}: {onlineInstances.length} {t('aiDashboard.agentCard.online')}
            {' / '}
            {runningInstances.length} {t('aiDashboard.agentCard.running')}
          </>
        ) : (
          <span className="text-slate-500">{t('aiDashboard.agentCard.noInstances')}</span>
        )}
      </div>

      {/* Success rate bar */}
      {totalExec > 0 && (
        <div className="flex items-center gap-2 relative">
          <div className="flex-1 h-1.5 rounded-full bg-slate-700">
            <div
              className={`h-1.5 rounded-full ${barColor} transition-all`}
              style={{ width: `${Math.min(100, successRate)}%` }}
            />
          </div>
          <span className="text-xs text-slate-400 whitespace-nowrap">
            {Math.round(successRate)}%
          </span>
          <span className="text-xs text-slate-500 whitespace-nowrap">
            {totalExec}{t('aiDashboard.executions')}
          </span>
          <span className="text-xs text-slate-500 whitespace-nowrap">
            {t('aiDashboard.avgDuration', { ms: Math.round(avgMs) })}
          </span>
        </div>
      )}
    </div>
  );
};

export default AgentStatusCard;
