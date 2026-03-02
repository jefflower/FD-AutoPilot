import React from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Bot, Activity, ArrowLeftRight, TrendingUp } from 'lucide-react';

interface StatsBarProps {
  onlineClients: number;
  totalAgents: number;
  enabledAgents: number;
  runningInstances: number;
  totalInstances: number;
  syncBridgeWaiting: number;
  overallSuccessRate: number;
  totalExecutions: number;
  avgDurationMs: number;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subLabel?: string;
  bottomInfo?: string;
  color: string;
}

const colorMap: Record<string, { bg: string; text: string }> = {
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  red: { bg: 'bg-red-500/10', text: 'text-red-400' },
};

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, subLabel, bottomInfo, color }) => {
  const colors = colorMap[color] || colorMap.indigo;
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex-1 min-w-0">
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
  runningInstances,
  totalInstances,
  syncBridgeWaiting,
  overallSuccessRate,
  totalExecutions,
  avgDurationMs,
}) => {
  const { t } = useTranslation('common');

  const successRateColor = overallSuccessRate > 80 ? 'emerald' : overallSuccessRate > 60 ? 'amber' : 'red';

  return (
    <div className="flex gap-3 flex-wrap lg:flex-nowrap">
      <StatCard
        icon={<Monitor className="w-5 h-5" />}
        label={t('aiDashboard.onlineClients')}
        value={onlineClients}
        color="cyan"
      />
      <StatCard
        icon={<Bot className="w-5 h-5" />}
        label={t('aiDashboard.totalAgents')}
        value={totalAgents}
        subLabel={t('aiDashboard.enabledCount', { count: enabledAgents })}
        color="indigo"
      />
      <StatCard
        icon={<Activity className="w-5 h-5" />}
        label={t('aiDashboard.runningInstances')}
        value={`${runningInstances} / ${totalInstances}`}
        color="emerald"
      />
      <StatCard
        icon={<ArrowLeftRight className="w-5 h-5" />}
        label={t('aiDashboard.syncBridge')}
        value={syncBridgeWaiting}
        subLabel={t('aiDashboard.activeWaiting')}
        color="blue"
      />
      <StatCard
        icon={<TrendingUp className="w-5 h-5" />}
        label={t('aiDashboard.successRate')}
        value={`${overallSuccessRate}%`}
        subLabel={`${totalExecutions} ${t('aiDashboard.executions')}`}
        bottomInfo={t('aiDashboard.avgDuration', { ms: avgDurationMs })}
        color={successRateColor}
      />
    </div>
  );
};

export default StatsBar;
