import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Monitor,
  MonitorOff,
  Keyboard,
  Coffee,
  Zap,
  User,
  MousePointer2,
  LampDesk,
} from 'lucide-react';
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
  /** 该 Agent 是否正在轮询任务（autoStart 或手动启动） */
  isPolling?: boolean;
}

type DeskStatus = 'executing' | 'standby' | 'enabled' | 'disabled';

function getDeskStatus(
  definition: AgentDefinition,
  executingCount: number,
  isPolling: boolean,
): DeskStatus {
  if (!definition.enabled) return 'disabled';
  if (executingCount > 0) return 'executing';
  if (isPolling) return 'standby';   // 正在轮询 = 坐在工位上待命
  return 'enabled';                  // 已启用但未轮询 = 在休息
}

function formatElapsed(createdAt: string): string {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  if (elapsed < 1000) return '<1s';
  if (elapsed < 60000) return `${Math.floor(elapsed / 1000)}s`;
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m${Math.floor((elapsed % 60000) / 1000)}s`;
  return `${Math.floor(elapsed / 3600000)}h${Math.floor((elapsed % 3600000) / 60000)}m`;
}

/* ---------- Workstation SVG Illustration ---------- */

/** Executing: person typing at desk with active screen + lamp on */
const WorkstationExecuting: React.FC = () => (
  <div className="desk-scene desk-scene--executing relative w-full h-24 flex items-end justify-center">
    {/* Desk lamp */}
    <div className="absolute left-3 top-1">
      <LampDesk className="w-6 h-6 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.5)]" />
      {/* lamp glow */}
      <div className="absolute -bottom-1 left-1 w-4 h-4 bg-amber-400/20 rounded-full blur-md" />
    </div>

    {/* Monitor */}
    <div className="relative flex flex-col items-center">
      {/* Screen glow */}
      <div className="absolute -inset-2 bg-blue-500/10 rounded-xl blur-lg desk-screen-glow" />
      <Monitor className="w-12 h-12 text-blue-400 relative z-10" strokeWidth={1.5} />
      {/* Screen content - typing cursor animation */}
      <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 flex gap-0.5 items-center">
        <div className="w-1 h-1 rounded-full bg-blue-300 desk-typing-dot" style={{ animationDelay: '0ms' }} />
        <div className="w-1 h-1 rounded-full bg-blue-300 desk-typing-dot" style={{ animationDelay: '150ms' }} />
        <div className="w-1 h-1 rounded-full bg-blue-300 desk-typing-dot" style={{ animationDelay: '300ms' }} />
      </div>
      {/* Monitor stand */}
      <div className="w-3 h-1.5 bg-slate-600 rounded-b-sm" />
      <div className="w-8 h-1 bg-slate-600 rounded-b-md" />
    </div>

    {/* Person sitting */}
    <div className="absolute right-5 bottom-0 flex flex-col items-center">
      <User className="w-7 h-7 text-blue-300 desk-person-typing" strokeWidth={1.5} />
    </div>

    {/* Keyboard */}
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
      <Keyboard className="w-8 h-4 text-slate-500 desk-keyboard-glow" strokeWidth={1.5} />
    </div>

    {/* Mouse */}
    <div className="absolute bottom-0.5 right-12">
      <MousePointer2 className="w-3 h-3 text-slate-500" strokeWidth={1.5} />
    </div>

    {/* Desk surface line */}
    <div className="absolute bottom-0 inset-x-2 h-px bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />
  </div>
);

/** Standby: person at desk, screen on but idle, calm state */
const WorkstationStandby: React.FC = () => (
  <div className="desk-scene desk-scene--standby relative w-full h-24 flex items-end justify-center">
    {/* Desk lamp */}
    <div className="absolute left-3 top-1">
      <LampDesk className="w-6 h-6 text-emerald-400/70 drop-shadow-[0_0_4px_rgba(52,211,153,0.3)]" />
    </div>

    {/* Monitor */}
    <div className="relative flex flex-col items-center">
      <div className="absolute -inset-2 bg-emerald-500/5 rounded-xl blur-lg desk-standby-glow" />
      <Monitor className="w-12 h-12 text-emerald-400/70 relative z-10" strokeWidth={1.5} />
      {/* Screen content - standby indicator */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
        <div className="w-2 h-2 rounded-full bg-emerald-400/60 desk-standby-pulse" />
      </div>
      <div className="w-3 h-1.5 bg-slate-600/80 rounded-b-sm" />
      <div className="w-8 h-1 bg-slate-600/80 rounded-b-md" />
    </div>

    {/* Person sitting calmly */}
    <div className="absolute right-5 bottom-0 flex flex-col items-center">
      <User className="w-7 h-7 text-emerald-300/70" strokeWidth={1.5} />
    </div>

    {/* Keyboard */}
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
      <Keyboard className="w-8 h-4 text-slate-600" strokeWidth={1.5} />
    </div>

    <div className="absolute bottom-0.5 right-12">
      <MousePointer2 className="w-3 h-3 text-slate-600" strokeWidth={1.5} />
    </div>

    <div className="absolute bottom-0 inset-x-2 h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
  </div>
);

/** Enabled but not started: desk with coffee, screen on but nobody working */
const WorkstationEnabled: React.FC = () => (
  <div className="desk-scene desk-scene--enabled relative w-full h-24 flex items-end justify-center opacity-70">
    {/* Desk lamp - dim */}
    <div className="absolute left-3 top-1">
      <LampDesk className="w-6 h-6 text-yellow-600/50" />
    </div>

    {/* Monitor - on but dim */}
    <div className="relative flex flex-col items-center">
      <Monitor className="w-12 h-12 text-yellow-500/50 relative z-10" strokeWidth={1.5} />
      {/* screensaver */}
      <div className="absolute top-3.5 left-1/2 -translate-x-1/2 z-20">
        <div className="w-1.5 h-1.5 rounded-full bg-yellow-400/40" />
      </div>
      <div className="w-3 h-1.5 bg-slate-700/60 rounded-b-sm" />
      <div className="w-8 h-1 bg-slate-700/60 rounded-b-md" />
    </div>

    {/* Coffee cup instead of person - on break */}
    <div className="absolute right-5 bottom-0 flex flex-col items-center">
      <Coffee className="w-6 h-6 text-yellow-500/60" strokeWidth={1.5} />
      {/* steam */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex gap-0.5">
        <div className="w-0.5 h-2 bg-yellow-400/20 rounded-full desk-steam" style={{ animationDelay: '0ms' }} />
        <div className="w-0.5 h-2 bg-yellow-400/20 rounded-full desk-steam" style={{ animationDelay: '300ms' }} />
      </div>
    </div>

    {/* Keyboard */}
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
      <Keyboard className="w-8 h-4 text-slate-700" strokeWidth={1.5} />
    </div>

    <div className="absolute bottom-0 inset-x-2 h-px bg-gradient-to-r from-transparent via-slate-600/20 to-transparent" />
  </div>
);

/** Disabled: empty desk, monitor off, no person */
const WorkstationDisabled: React.FC = () => (
  <div className="desk-scene desk-scene--disabled relative w-full h-24 flex items-end justify-center opacity-40">
    {/* Desk lamp - off */}
    <div className="absolute left-3 top-1">
      <LampDesk className="w-6 h-6 text-slate-700" />
    </div>

    {/* Monitor off */}
    <div className="relative flex flex-col items-center">
      <MonitorOff className="w-12 h-12 text-slate-700 relative z-10" strokeWidth={1.5} />
      <div className="w-3 h-1.5 bg-slate-800 rounded-b-sm" />
      <div className="w-8 h-1 bg-slate-800 rounded-b-md" />
    </div>

    {/* Empty chair hint */}
    <div className="absolute right-5 bottom-0.5 flex flex-col items-center">
      <div className="w-5 h-5 rounded-full border border-dashed border-slate-700 flex items-center justify-center">
        <User className="w-3 h-3 text-slate-700" strokeWidth={1.5} />
      </div>
    </div>

    {/* Keyboard */}
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
      <Keyboard className="w-8 h-4 text-slate-800" strokeWidth={1.5} />
    </div>

    <div className="absolute bottom-0 inset-x-2 h-px bg-gradient-to-r from-transparent via-slate-700/20 to-transparent" />
  </div>
);

const WorkstationScene: Record<DeskStatus, React.FC> = {
  executing: WorkstationExecuting,
  standby: WorkstationStandby,
  enabled: WorkstationEnabled,
  disabled: WorkstationDisabled,
};

/* ---------- Status config ---------- */

const statusConfig: Record<DeskStatus, {
  border: string;
  bg: string;
  label: string;
  labelKey: string;
  tagBg: string;
  tagText: string;
  nameplateAccent: string;
}> = {
  executing: {
    border: 'border-blue-500/50 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/20',
    bg: 'bg-slate-800/95',
    label: '工作中',
    labelKey: 'aiDashboard.deskCard.executing',
    tagBg: 'bg-blue-500/15',
    tagText: 'text-blue-400',
    nameplateAccent: 'from-blue-500/30 to-blue-600/10',
  },
  standby: {
    border: 'border-emerald-500/40 shadow-md shadow-emerald-500/5',
    bg: 'bg-slate-800/80',
    label: '待命中',
    labelKey: 'aiDashboard.deskCard.standby',
    tagBg: 'bg-emerald-500/15',
    tagText: 'text-emerald-400',
    nameplateAccent: 'from-emerald-500/20 to-emerald-600/5',
  },
  enabled: {
    border: 'border-slate-700/50',
    bg: 'bg-slate-800/60',
    label: '已启用',
    labelKey: 'aiDashboard.deskCard.enabled',
    tagBg: 'bg-yellow-500/15',
    tagText: 'text-yellow-400',
    nameplateAccent: 'from-yellow-500/15 to-yellow-600/5',
  },
  disabled: {
    border: 'border-slate-700/30',
    bg: 'bg-slate-800/30',
    label: '未启用',
    labelKey: 'aiDashboard.deskCard.disabled',
    tagBg: 'bg-slate-500/15',
    tagText: 'text-slate-500',
    nameplateAccent: 'from-slate-600/10 to-slate-700/5',
  },
};

/* ---------- Component ---------- */

const DeskCard: React.FC<DeskCardProps> = ({
  definition,
  instances: _instances,
  onlineClientIds: _onlineClientIds,
  stats,
  executingCount,
  currentExecution,
  onToggle,
  onClick,
  compact = false,
  isPolling = false,
}) => {
  const { t } = useTranslation('common');

  const status = useMemo(
    () => getDeskStatus(definition, executingCount, isPolling),
    [definition, executingCount, isPolling],
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

  const Scene = WorkstationScene[status];

  // compact mode (for floating panel)
  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`rounded-lg border p-3 cursor-pointer transition-all ${config.border} ${config.bg} hover:border-slate-600/60`}
      >
        {/* Row 1: desk icon + code + status tag */}
        <div className="flex items-center gap-2 mb-1">
          {status === 'executing' ? (
            <Monitor className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 desk-compact-pulse" />
          ) : status === 'standby' ? (
            <Monitor className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          ) : status === 'enabled' ? (
            <Coffee className="w-3.5 h-3.5 text-yellow-400/70 flex-shrink-0" />
          ) : (
            <MonitorOff className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          )}
          <span className="text-xs font-medium text-white truncate flex-1">{definition.code}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${config.tagBg} ${config.tagText}`}>
            {t(config.labelKey, config.label)}
          </span>
        </div>
        {/* Row 2: name */}
        <div className="text-xs text-slate-400 truncate mb-1">{definition.name}</div>
        {/* Row 3: working status */}
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

  // normal mode - full workstation card
  return (
    <div
      onClick={onClick}
      className={`group rounded-xl border cursor-pointer transition-all relative overflow-hidden ${config.border} ${config.bg} hover:border-slate-500/50 hover:translate-y-[-1px]`}
    >
      {/* executing background pulse */}
      {status === 'executing' && (
        <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 via-blue-400/8 to-transparent animate-pulse pointer-events-none" />
      )}

      {/* ===== Workstation Illustration ===== */}
      <div className="relative px-4 pt-3 pb-1">
        <Scene />
      </div>

      {/* ===== Nameplate: code + toggle ===== */}
      <div className={`mx-3 mb-2 px-3 py-1.5 rounded-lg bg-gradient-to-r ${config.nameplateAccent} backdrop-blur-sm relative`}>
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate leading-tight">{definition.code}</div>
            <div className="text-[11px] text-slate-400 truncate">{definition.name}</div>
          </div>
          {/* Toggle switch */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              if (definition.enabled) onToggle(definition.id);
            }}
            title={isPolling ? t('aiDashboard.deskCard.stopPolling', '停止轮询') : t('aiDashboard.deskCard.startPolling', '启动轮询')}
            className={`w-9 h-[18px] rounded-full transition-colors flex-shrink-0 relative ml-2 ${
              !definition.enabled ? 'bg-slate-700 cursor-not-allowed' :
              isPolling ? 'bg-indigo-500 cursor-pointer hover:bg-indigo-400' : 'bg-slate-600 cursor-pointer hover:bg-slate-500'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm absolute top-[1.5px] transition-all ${
                isPolling ? 'left-[19px]' : 'left-[2px]'
              }`}
            />
          </div>
        </div>
      </div>

      {/* ===== Status + Capability ===== */}
      <div className="px-3 pb-2 relative">
        {/* Status tag */}
        <div className={`flex items-center gap-1.5 mb-1.5 px-2 py-1 rounded-md text-xs font-medium ${config.tagBg} ${config.tagText}`}>
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
          ) : (
            <span>{t(config.labelKey, config.label)}</span>
          )}
        </div>

        {/* Capability badge */}
        <div className="text-[11px] text-slate-500 mb-2 truncate">
          {t('aiDashboard.agentCard.capability', '能力')}: <span className="text-slate-400">{capability}</span>
        </div>

        {/* Execution stats + success bar */}
        {totalExec > 0 && (
          <div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-1 flex-wrap">
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
            <div className="h-1 rounded-full bg-slate-700/80">
              <div
                className={`h-1 rounded-full ${barColor} transition-all`}
                style={{ width: `${Math.min(100, successRate)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeskCard;
