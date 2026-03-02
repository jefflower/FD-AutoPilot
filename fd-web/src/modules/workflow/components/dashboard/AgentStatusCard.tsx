import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentDefinition, AgentInstance, AgentStats } from '../../../../shared/types/server';

interface AgentStatusCardProps {
  definition: AgentDefinition;
  instances: AgentInstance[];
  onlineClientIds: Set<string>;
  stats?: AgentStats;
  isSelected: boolean;
  onSelect: (code: string) => void;
  onToggle: (id: number) => void;
}

const AgentStatusCard: React.FC<AgentStatusCardProps> = ({
  definition,
  instances,
  onlineClientIds,
  stats,
  isSelected,
  onSelect,
  onToggle,
}) => {
  const { t } = useTranslation('common');

  const onlineInstances = instances.filter(i => onlineClientIds.has(i.clientId));
  const runningInstances = instances.filter(i => i.running);

  // Status light: running=green pulse, enabled no instance=yellow, disabled=red
  const hasRunning = runningInstances.length > 0;
  const statusDotClass = hasRunning
    ? 'bg-emerald-400 animate-pulse'
    : definition.enabled
      ? instances.length > 0 ? 'bg-yellow-400' : 'bg-yellow-400'
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
      className={`rounded-xl border p-4 cursor-pointer transition-all ${
        isSelected
          ? 'border-indigo-500/50 bg-slate-800/80 shadow-lg shadow-indigo-500/5'
          : 'border-slate-700/50 bg-slate-800/50 hover:border-slate-600/50'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
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
      <div className="text-xs text-slate-400 mb-1 truncate">{definition.name}</div>

      {/* Capability */}
      <div className="text-xs text-slate-500 mb-2">
        {t('aiDashboard.agentCard.capability')}: {definition.capability || definition.requiredCapability || '-'}
      </div>

      {/* Instance info */}
      <div className="text-xs text-slate-400 mb-2">
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
        <div className="flex items-center gap-2">
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
