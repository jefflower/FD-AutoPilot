import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MQTask } from '../../../shared/context/createMQTaskContext';

interface StagePanelProps {
    title: string;
    color: 'cyan' | 'orange' | 'rose';
    isRunning: boolean;
    onToggle: () => void;
    processingTasks: Map<number, MQTask>;
    completedHistory: MQTask[];
    onSelectTicket?: (ticketId: number) => void;
    selectedTicketId?: number | null;
    disabled?: boolean;
    disabledMessage?: string;
}

const colorStyles = {
    cyan: {
        header: 'from-cyan-900/40 to-slate-900/60',
        dot: 'bg-cyan-500',
        dotPing: 'bg-cyan-400',
        title: 'text-cyan-400',
        badge: 'bg-cyan-500/20 text-cyan-300',
        activeCard: 'bg-cyan-500/10 border-cyan-500/20',
        activeMono: 'text-cyan-300',
        activeLabel: 'text-cyan-500',
        btnStart: 'bg-cyan-600 hover:bg-cyan-500',
        btnStop: 'bg-slate-700 hover:bg-slate-600',
        indicator: 'border-cyan-500/30 border-t-cyan-500',
        selected: 'bg-cyan-500/15 border-cyan-500/30',
    },
    orange: {
        header: 'from-orange-900/40 to-slate-900/60',
        dot: 'bg-orange-500',
        dotPing: 'bg-orange-400',
        title: 'text-orange-400',
        badge: 'bg-orange-500/20 text-orange-300',
        activeCard: 'bg-orange-500/10 border-orange-500/20',
        activeMono: 'text-orange-300',
        activeLabel: 'text-orange-500',
        btnStart: 'bg-orange-600 hover:bg-orange-500',
        btnStop: 'bg-slate-700 hover:bg-slate-600',
        indicator: 'border-orange-500/30 border-t-orange-500',
        selected: 'bg-orange-500/15 border-orange-500/30',
    },
    rose: {
        header: 'from-rose-900/40 to-slate-900/60',
        dot: 'bg-rose-500',
        dotPing: 'bg-rose-400',
        title: 'text-rose-400',
        badge: 'bg-rose-500/20 text-rose-300',
        activeCard: 'bg-rose-500/10 border-rose-500/20',
        activeMono: 'text-rose-300',
        activeLabel: 'text-rose-500',
        btnStart: 'bg-rose-600 hover:bg-rose-500',
        btnStop: 'bg-slate-700 hover:bg-slate-600',
        indicator: 'border-rose-500/30 border-t-rose-500',
        selected: 'bg-rose-500/15 border-rose-500/30',
    },
};

const StagePanel: React.FC<StagePanelProps> = ({
    title,
    color,
    isRunning,
    onToggle,
    processingTasks,
    completedHistory,
    onSelectTicket,
    selectedTicketId,
    disabled = false,
    disabledMessage,
}) => {
    const { t } = useTranslation('tasks');
    const [showHistory, setShowHistory] = useState(false);
    const cs = colorStyles[color];
    const processingList = Array.from(processingTasks.values());

    // Filter out processing task IDs from completed history
    const processingIds = new Set(processingList.map(t => t.ticketId));
    const filteredHistory = completedHistory.filter(t => !processingIds.has(t.ticketId));

    return (
        <div className="flex flex-col h-full bg-slate-900/30 rounded-lg border border-slate-700/50 overflow-hidden">
            {/* Header */}
            <div className={`px-3 py-2.5 bg-gradient-to-r ${cs.header} border-b border-slate-700/50`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {isRunning ? (
                            <span className="relative flex h-2 w-2">
                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cs.dotPing} opacity-75`} />
                                <span className={`relative inline-flex rounded-full h-2 w-2 ${cs.dot}`} />
                            </span>
                        ) : (
                            <span className="inline-flex rounded-full h-2 w-2 bg-slate-600" />
                        )}
                        <h3 className={`text-xs font-bold ${cs.title}`}>{title}</h3>
                        {processingList.length > 0 && (
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${cs.badge}`}>
                                {processingList.length}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={onToggle}
                        disabled={disabled}
                        className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all text-white disabled:opacity-30 disabled:cursor-not-allowed ${
                            isRunning ? cs.btnStop : cs.btnStart
                        }`}
                    >
                        {isRunning ? t('translation.stopConsumer') : t('translation.startConsumer')}
                    </button>
                </div>
            </div>

            {/* Disabled overlay */}
            {disabled && disabledMessage && (
                <div className="px-3 py-2 bg-amber-500/5 border-b border-amber-500/10">
                    <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <span className="text-[10px] text-amber-400">{disabledMessage}</span>
                    </div>
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                {/* Processing tasks */}
                {processingList.map(task => (
                    <div
                        key={task.ticketId}
                        onClick={() => onSelectTicket?.(task.ticketId)}
                        className={`p-2 rounded-lg border cursor-pointer transition-all ${
                            selectedTicketId === task.ticketId
                                ? cs.selected
                                : `${cs.activeCard} hover:brightness-110`
                        }`}
                    >
                        <div className="flex items-center justify-between mb-0.5">
                            <span className={`text-[10px] font-black font-mono ${cs.activeMono}`}>#{task.externalId}</span>
                            <div className={`w-3 h-3 border-2 ${cs.indicator} rounded-full animate-spin`} />
                        </div>
                        <div className="text-[10px] text-slate-300 truncate">{task.subject}</div>
                    </div>
                ))}

                {/* Empty state */}
                {processingList.length === 0 && (
                    <div className="text-center py-6 text-slate-600 text-[10px] italic">
                        {isRunning ? t('automation.noTasks') : t('translation.idle')}
                    </div>
                )}
            </div>

            {/* Completed history toggle */}
            {filteredHistory.length > 0 && (
                <div className="border-t border-slate-700/50">
                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        className="w-full px-3 py-1.5 flex items-center justify-between text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        <span className="font-bold uppercase tracking-wide">
                            {t('automation.completed')} ({filteredHistory.length})
                        </span>
                        <svg
                            className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-180' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                    </button>

                    {showHistory && (
                        <div className="px-2 pb-2 space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                            {filteredHistory.slice(0, 10).map(task => {
                                const statusStyle = task.status === 'failed'
                                    ? 'bg-red-500/10 border-red-500/20 text-red-400'
                                    : task.status === 'skipped'
                                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                                    : 'bg-green-500/5 border-green-500/10 text-green-500/60';
                                const statusLabel = task.status === 'failed'
                                    ? t('translation.statusFailed')
                                    : task.status === 'skipped'
                                    ? t('translation.statusSkipped')
                                    : t('translation.statusDone');

                                return (
                                    <div
                                        key={`${task.ticketId}-${task.addedAt}`}
                                        onClick={() => onSelectTicket?.(task.ticketId)}
                                        className={`p-1.5 rounded-lg border cursor-pointer transition-all hover:brightness-125 ${statusStyle}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-mono text-slate-500">#{task.externalId}</span>
                                            <span className="text-[9px] font-bold uppercase">{statusLabel}</span>
                                        </div>
                                        <div className="text-[9px] text-slate-500 truncate">{task.subject}</div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default StagePanel;
