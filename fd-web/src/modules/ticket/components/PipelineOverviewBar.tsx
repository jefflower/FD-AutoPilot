import React from 'react';
import { useTranslation } from 'react-i18next';

export interface PipelineStage {
    id: string;
    label: string;
    activeCount: number;
    completedCount: number;
    isRunning: boolean;
    color: string; // 'cyan' | 'orange' | 'rose'
}

interface PipelineOverviewBarProps {
    stages: PipelineStage[];
    onStartAll: () => void;
    onStopAll: () => void;
    allRunning: boolean;
    onSettingsClick?: () => void;
    showSettings?: boolean;
}

const colorMap: Record<string, { bg: string; text: string; ring: string; dot: string; badge: string }> = {
    cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', ring: 'ring-cyan-500/30', dot: 'bg-cyan-500', badge: 'bg-cyan-500/20 text-cyan-300' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', ring: 'ring-orange-500/30', dot: 'bg-orange-500', badge: 'bg-orange-500/20 text-orange-300' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', ring: 'ring-rose-500/30', dot: 'bg-rose-500', badge: 'bg-rose-500/20 text-rose-300' },
};

const PipelineOverviewBar: React.FC<PipelineOverviewBarProps> = ({
    stages,
    onStartAll,
    onStopAll,
    allRunning,
    onSettingsClick,
    showSettings,
}) => {
    const { t } = useTranslation('tasks');

    return (
        <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/50 border-b border-slate-700/50">
            {/* Pipeline stages */}
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {stages.map((stage, idx) => {
                    const colors = colorMap[stage.color] || colorMap.cyan;
                    return (
                        <React.Fragment key={stage.id}>
                            {idx > 0 && (
                                <svg className="w-4 h-4 text-slate-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            )}
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${colors.bg} ring-1 ${colors.ring} min-w-0`}>
                                {/* Running indicator */}
                                <div className="relative flex-shrink-0">
                                    {stage.isRunning ? (
                                        <span className="relative flex h-2 w-2">
                                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colors.dot} opacity-75`} />
                                            <span className={`relative inline-flex rounded-full h-2 w-2 ${colors.dot}`} />
                                        </span>
                                    ) : (
                                        <span className="inline-flex rounded-full h-2 w-2 bg-slate-600" />
                                    )}
                                </div>

                                {/* Label */}
                                <span className={`text-[11px] font-bold ${colors.text} whitespace-nowrap`}>
                                    {stage.label}
                                </span>

                                {/* Active count badge */}
                                {stage.activeCount > 0 && (
                                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${colors.badge}`}>
                                        {stage.activeCount}
                                    </span>
                                )}

                                {/* Completed count */}
                                {stage.completedCount > 0 && (
                                    <span className="text-[10px] font-mono text-slate-500">
                                        {stage.completedCount}
                                        <span className="text-[8px] ml-0.5">{t('automation.completed')}</span>
                                    </span>
                                )}
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Global start/stop */}
            <button
                onClick={allRunning ? onStopAll : onStartAll}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex-shrink-0 ${
                    allRunning
                        ? 'bg-red-600/80 hover:bg-red-500 text-white'
                        : 'bg-emerald-600/80 hover:bg-emerald-500 text-white'
                }`}
            >
                {allRunning ? (
                    <>
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="6" width="12" height="12" rx="1" />
                        </svg>
                        {t('automation.stopAll')}
                    </>
                ) : (
                    <>
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                        {t('automation.startAll')}
                    </>
                )}
            </button>

            {/* Settings */}
            {onSettingsClick && (
                <button
                    onClick={onSettingsClick}
                    className={`p-2 rounded-lg transition-all flex-shrink-0 ${
                        showSettings
                            ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/30'
                            : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'
                    }`}
                    title={t('automation.settings')}
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                </button>
            )}
        </div>
    );
};

export default PipelineOverviewBar;
