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
        </div>
    );
};

export default PipelineOverviewBar;
