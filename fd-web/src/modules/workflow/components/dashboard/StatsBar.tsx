import React from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Bot, TrendingUp, Zap } from 'lucide-react';

interface StatsBarProps {
  onlineClients: number;
  totalAgents: number;
  enabledAgents: number;
  runningOnlineAgents: number;
  executingTasks: number;
  overallSuccessRate: number;
  totalExecutions: number;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subLabel?: string;
  bottomInfo?: string;
  color: string;
  pulse?: boolean;
}

const colorMap: Record<string, { bg: string; text: string }> = {
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  red: { bg: 'bg-red-500/10', text: 'text-red-400' },
};

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, subLabel, bottomInfo, color, pulse }) => {
  const colors = colorMap[color] || colorMap.indigo;
  return (
    <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex-1 min-w-0 ${pulse ? 'animate-pulse' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors.bg} ${colors.text}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-bold text-white">{value}</div>
          <div className="text-xs text-slate-400 truncate">{label}</div>
        </div>
      </div>
      {(subLabel || bottomInfo) && (
        <div className="mt-2 flex items-center justify-between">
          {subLabel && <span className="text-xs text-slate-500">{subLabel}</span>}
          {bottomInfo && <span className="text-xs text-slate-500">{bottomInfo}</span>}
        </div>
      )}
    </div>
  );
};

const StatsBar: React.FC<StatsBarProps> = ({
  onlineClients,
  totalAgents,
  enabledAgents,
  runningOnlineAgents,
  executingTasks,
  overallSuccessRate,
  totalExecutions,
}) => {
  const { t } = useTranslation('common');

  const successRateColor = overallSuccessRate > 80 ? 'emerald' : overallSuccessRate > 60 ? 'amber' : 'red';

  return (
    <div className="flex gap-3 flex-wrap lg:flex-nowrap">
      {/* 1. 在线客户端 */}
      <StatCard
        icon={<Monitor className="w-5 h-5" />}
        label={t('aiDashboard.onlineClients')}
        value={onlineClients}
        color="cyan"
      />
      {/* 2. Agent 概况 */}
      <StatCard
        icon={<Bot className="w-5 h-5" />}
        label={t('aiDashboard.totalAgents')}
        value={`${enabledAgents}/${totalAgents}`}
        subLabel={t('aiDashboard.enabledCount', { count: enabledAgents })}
        bottomInfo={`${runningOnlineAgents} ${t('aiDashboard.agentCard.online', '在线')}`}
        color="indigo"
      />
      {/* 3. 执行中任务 */}
      <StatCard
        icon={<Zap className="w-5 h-5" />}
        label={t('aiDashboard.executingTasks')}
        value={executingTasks}
        subLabel={executingTasks > 0 ? t('aiDashboard.processing') : t('aiDashboard.idle')}
        color={executingTasks > 0 ? 'amber' : 'blue'}
        pulse={executingTasks > 0}
      />
      {/* 4. 整体成功率 */}
      <StatCard
        icon={<TrendingUp className="w-5 h-5" />}
        label={t('aiDashboard.successRate')}
        value={`${overallSuccessRate}%`}
        subLabel={`${totalExecutions} ${t('aiDashboard.executions')}`}
        color={successRateColor}
      />
    </div>
  );
};

export default StatsBar;
