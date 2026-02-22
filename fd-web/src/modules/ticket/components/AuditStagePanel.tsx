import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MQTask } from '../../../shared/context/createMQTaskContext';

interface AuditStagePanelProps {
    isRunning: boolean;
    onToggle: () => void;
    processingTasks: Map<number, MQTask>;
    completedHistory: MQTask[];
    onPass: (ticketId: number) => void;
    onReject: (ticketId: number, remark: string) => void;
    onRetranslate: (ticketId: number, remark: string) => void;
    onSelectTicket?: (ticketId: number) => void;
    selectedTicketId?: number | null;
}

type RemarkMode = { type: 'reject' | 'retranslate'; ticketId: number } | null;

const AuditStagePanel: React.FC<AuditStagePanelProps> = ({
    isRunning,
    onToggle,
    processingTasks,
    completedHistory,
    onPass,
    onReject,
    onRetranslate,
    onSelectTicket,
    selectedTicketId,
}) => {
    const { t } = useTranslation(['tasks', 'common']);
    const [remarkMode, setRemarkMode] = useState<RemarkMode>(null);
    const [remark, setRemark] = useState('');
    const [showHistory, setShowHistory] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const processingList = Array.from(processingTasks.values());
    const processingIds = new Set(processingList.map(t => t.ticketId));
    const filteredHistory = completedHistory.filter(t => !processingIds.has(t.ticketId));

    const handleSubmitRemark = async () => {
        if (!remarkMode) return;
        setSubmitting(true);
        try {
            if (remarkMode.type === 'reject') {
                await onReject(remarkMode.ticketId, remark);
            } else {
                await onRetranslate(remarkMode.ticketId, remark);
            }
            setRemarkMode(null);
            setRemark('');
        } finally {
            setSubmitting(false);
        }
    };

    const openRemarkInput = (type: 'reject' | 'retranslate', ticketId: number) => {
        if (remarkMode?.type === type && remarkMode?.ticketId === ticketId) {
            setRemarkMode(null);
            setRemark('');
        } else {
            setRemarkMode({ type, ticketId });
            setRemark('');
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-900/30 rounded-lg border border-slate-700/50 overflow-hidden">
            {/* Header */}
            <div className="px-3 py-2.5 bg-gradient-to-r from-rose-900/40 to-slate-900/60 border-b border-slate-700/50">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {isRunning ? (
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                            </span>
                        ) : (
                            <span className="inline-flex rounded-full h-2 w-2 bg-slate-600" />
                        )}
                        <h3 className="text-xs font-bold text-rose-400">{t('automation.stageAudit')}</h3>
                        {processingList.length > 0 && (
                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300">
                                {processingList.length}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={onToggle}
                        className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all text-white ${
                            isRunning
                                ? 'bg-slate-700 hover:bg-slate-600'
                                : 'bg-rose-600 hover:bg-rose-500'
                        }`}
                    >
                        {isRunning ? t('audit.stopConsumer') : t('audit.startConsumer')}
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
                {processingList.map(task => {
                    const isThisRemarkOpen = remarkMode?.ticketId === task.ticketId;

                    return (
                        <div
                            key={task.ticketId}
                            className={`p-2.5 rounded-lg border transition-all ${
                                selectedTicketId === task.ticketId
                                    ? 'bg-rose-500/15 border-rose-500/30'
                                    : 'bg-rose-500/10 border-rose-500/20'
                            }`}
                        >
                            {/* Ticket info */}
                            <div
                                className="cursor-pointer"
                                onClick={() => onSelectTicket?.(task.ticketId)}
                            >
                                <div className="flex items-center justify-between mb-0.5">
                                    <span className="text-[10px] font-black font-mono text-rose-300">#{task.externalId}</span>
                                    <div className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-pulse" />
                                </div>
                                <div className="text-[10px] text-slate-300 truncate">{task.subject}</div>
                            </div>

                            {/* Action buttons - grid layout for compact display */}
                            <div className="mt-2 grid grid-cols-3 gap-1" onClick={(e) => e.stopPropagation()}>
                                {/* Pass */}
                                <button
                                    onClick={() => {
                                        setSubmitting(true);
                                        Promise.resolve(onPass(task.ticketId)).finally(() => setSubmitting(false));
                                    }}
                                    disabled={submitting}
                                    className="py-1.5 bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-30 text-white text-[10px] font-bold rounded-md transition-all flex items-center justify-center gap-0.5"
                                    title={t('audit.pass')}
                                >
                                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                    </svg>
                                    <span className="truncate">{t('audit.pass')}</span>
                                </button>

                                {/* Reject */}
                                <button
                                    onClick={() => openRemarkInput('reject', task.ticketId)}
                                    disabled={submitting}
                                    className={`py-1.5 text-[10px] font-bold rounded-md transition-all flex items-center justify-center gap-0.5 disabled:opacity-30 ${
                                        isThisRemarkOpen && remarkMode?.type === 'reject'
                                            ? 'bg-red-600 text-white'
                                            : 'bg-red-600/20 text-red-400 hover:bg-red-600/40'
                                    }`}
                                    title={t('audit.reject')}
                                >
                                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    <span className="truncate">{t('audit.reject')}</span>
                                </button>

                                {/* Retranslate */}
                                <button
                                    onClick={() => openRemarkInput('retranslate', task.ticketId)}
                                    disabled={submitting}
                                    className={`py-1.5 text-[10px] font-bold rounded-md transition-all flex items-center justify-center gap-0.5 disabled:opacity-30 ${
                                        isThisRemarkOpen && remarkMode?.type === 'retranslate'
                                            ? 'bg-amber-600 text-white'
                                            : 'bg-amber-600/20 text-amber-400 hover:bg-amber-600/40'
                                    }`}
                                    title={t('automation.retranslate')}
                                >
                                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    <span className="truncate">{t('automation.retranslate')}</span>
                                </button>
                            </div>

                            {/* Remark input */}
                            {isThisRemarkOpen && (
                                <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-top-1" onClick={(e) => e.stopPropagation()}>
                                    <textarea
                                        value={remark}
                                        onChange={(e) => setRemark(e.target.value)}
                                        placeholder={
                                            remarkMode.type === 'reject'
                                                ? t('audit.rejectPlaceholder')
                                                : t('automation.retranslateRemark')
                                        }
                                        className={`w-full bg-black/30 border rounded-lg p-2 text-xs text-white placeholder:text-slate-600 outline-none h-14 resize-none ${
                                            remarkMode.type === 'reject'
                                                ? 'border-rose-500/30 focus:border-rose-500'
                                                : 'border-amber-500/30 focus:border-amber-500'
                                        }`}
                                        autoFocus
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => { setRemarkMode(null); setRemark(''); }}
                                            className="px-3 py-1 text-[10px] font-bold text-slate-400 hover:text-white transition-colors"
                                        >
                                            {t('common:button.cancel')}
                                        </button>
                                        <button
                                            onClick={handleSubmitRemark}
                                            disabled={submitting}
                                            className={`px-4 py-1 text-white text-[10px] font-bold rounded-lg transition-all disabled:opacity-30 ${
                                                remarkMode.type === 'reject'
                                                    ? 'bg-rose-600 hover:bg-rose-500'
                                                    : 'bg-amber-600 hover:bg-amber-500'
                                            }`}
                                        >
                                            {submitting
                                                ? '...'
                                                : remarkMode.type === 'reject'
                                                    ? t('audit.confirmReject')
                                                    : t('automation.confirmRetranslate')
                                            }
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Empty state */}
                {processingList.length === 0 && (
                    <div className="text-center py-6 text-slate-600 text-[10px] italic">
                        {isRunning ? t('audit.waitingForTasks') : t('audit.startToAudit')}
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
                                    : 'bg-green-500/5 border-green-500/10 text-green-500/60';
                                const statusLabel = task.status === 'failed'
                                    ? t('audit.statusFailed')
                                    : t('audit.statusDone');

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

export default AuditStagePanel;
