import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MQTask } from '../../../shared/context/createMQTaskContext';

interface StageData {
    isRunning: boolean;
    onToggle: () => void;
    processingTasks: Map<number, MQTask>;
    completedHistory: MQTask[];
    disabled?: boolean;
    disabledMessage?: string;
}

interface AuditStageData extends StageData {
    onPass: (ticketId: number) => void;
    onReject: (ticketId: number, remark: string) => void;
    onRetranslate: (ticketId: number, remark: string) => void;
    onMobilePreview?: (ticketId: number) => void;
    previewLoading?: number | null;
}

interface PipelineSidebarProps {
    translation: StageData;
    reply: StageData;
    audit: AuditStageData;
    onSelectTicket: (ticketId: number) => void;
    selectedTicketId: number | null;
}

type RemarkMode = { type: 'reject' | 'retranslate'; ticketId: number } | null;

const stageConfig = {
    translation: {
        labelKey: 'automation.stageTranslation',
        dot: 'bg-cyan-500',
        dotPing: 'bg-cyan-400',
        title: 'text-cyan-400',
        badge: 'bg-cyan-500/20 text-cyan-300',
        card: 'bg-cyan-500/10 border-cyan-500/20',
        cardSelected: 'bg-cyan-500/15 border-cyan-500/30',
        mono: 'text-cyan-300',
        indicator: 'border-cyan-500/30 border-t-cyan-500',
        btnStart: 'bg-cyan-600 hover:bg-cyan-500',
        btnStop: 'bg-slate-700 hover:bg-slate-600',
        header: 'from-cyan-900/40 to-slate-900/60',
        historyPrefix: 'text-cyan-600',
        historyTag: '[T]',
    },
    reply: {
        labelKey: 'automation.stageReply',
        dot: 'bg-orange-500',
        dotPing: 'bg-orange-400',
        title: 'text-orange-400',
        badge: 'bg-orange-500/20 text-orange-300',
        card: 'bg-orange-500/10 border-orange-500/20',
        cardSelected: 'bg-orange-500/15 border-orange-500/30',
        mono: 'text-orange-300',
        indicator: 'border-orange-500/30 border-t-orange-500',
        btnStart: 'bg-orange-600 hover:bg-orange-500',
        btnStop: 'bg-slate-700 hover:bg-slate-600',
        header: 'from-orange-900/40 to-slate-900/60',
        historyPrefix: 'text-orange-600',
        historyTag: '[R]',
    },
    audit: {
        labelKey: 'automation.stageAudit',
        dot: 'bg-rose-500',
        dotPing: 'bg-rose-400',
        title: 'text-rose-400',
        badge: 'bg-rose-500/20 text-rose-300',
        card: 'bg-rose-500/10 border-rose-500/20',
        cardSelected: 'bg-rose-500/15 border-rose-500/30',
        mono: 'text-rose-300',
        indicator: 'border-rose-500/30 border-t-rose-500',
        btnStart: 'bg-rose-600 hover:bg-rose-500',
        btnStop: 'bg-slate-700 hover:bg-slate-600',
        header: 'from-rose-900/40 to-slate-900/60',
        historyPrefix: 'text-rose-600',
        historyTag: '[A]',
    },
} as const;

type StageName = keyof typeof stageConfig;

const PipelineSidebar: React.FC<PipelineSidebarProps> = ({
    translation,
    reply,
    audit,
    onSelectTicket,
    selectedTicketId,
}) => {
    const { t } = useTranslation(['tasks', 'common']);
    const [showHistory, setShowHistory] = useState(false);
    const [remarkMode, setRemarkMode] = useState<RemarkMode>(null);
    const [remark, setRemark] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmitRemark = async () => {
        if (!remarkMode) return;
        setSubmitting(true);
        try {
            if (remarkMode.type === 'reject') {
                await audit.onReject(remarkMode.ticketId, remark);
            } else {
                await audit.onRetranslate(remarkMode.ticketId, remark);
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

    // Render a generic stage section (translation/reply)
    const renderStageSection = (stage: StageData, name: StageName) => {
        const cfg = stageConfig[name];
        const processingList = Array.from(stage.processingTasks.values());

        return (
            <div className="border-b border-slate-700/50">
                {/* Section header */}
                <div className={`px-3 py-2 bg-gradient-to-r ${cfg.header} flex items-center justify-between`}>
                    <div className="flex items-center gap-2">
                        {stage.isRunning ? (
                            <span className="relative flex h-2 w-2">
                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dotPing} opacity-75`} />
                                <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dot}`} />
                            </span>
                        ) : (
                            <span className="inline-flex rounded-full h-2 w-2 bg-slate-600" />
                        )}
                        <span className={`text-xs font-bold ${cfg.title}`}>{t(cfg.labelKey)}</span>
                        {processingList.length > 0 && (
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
                                {processingList.length}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={stage.onToggle}
                        disabled={stage.disabled}
                        className={`px-2.5 py-0.5 text-[10px] font-bold rounded-md transition-all text-white disabled:opacity-30 disabled:cursor-not-allowed ${
                            stage.isRunning ? cfg.btnStop : cfg.btnStart
                        }`}
                    >
                        {stage.isRunning ? t('translation.stopConsumer') : t('translation.startConsumer')}
                    </button>
                </div>

                {/* Disabled message */}
                {stage.disabled && stage.disabledMessage && (
                    <div className="px-3 py-1.5 bg-amber-500/5 border-b border-amber-500/10">
                        <div className="flex items-center gap-2">
                            <svg className="w-3 h-3 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                            <span className="text-[10px] text-amber-400">{stage.disabledMessage}</span>
                        </div>
                    </div>
                )}

                {/* Processing tasks */}
                <div className="p-2 space-y-1">
                    {processingList.map(task => (
                        <div
                            key={task.ticketId}
                            onClick={() => onSelectTicket(task.ticketId)}
                            className={`p-2 rounded-lg border cursor-pointer transition-all ${
                                selectedTicketId === task.ticketId
                                    ? cfg.cardSelected
                                    : `${cfg.card} hover:brightness-110`
                            }`}
                        >
                            <div className="flex items-center justify-between mb-0.5">
                                <span className={`text-[10px] font-black font-mono ${cfg.mono}`}>#{task.externalId}</span>
                                <div className={`w-3 h-3 border-2 ${cfg.indicator} rounded-full animate-spin`} />
                            </div>
                            <div className="text-[10px] text-slate-300 truncate">{task.subject}</div>
                        </div>
                    ))}
                    {processingList.length === 0 && (
                        <div className="text-center py-3 text-slate-600 text-[10px] italic">
                            {stage.isRunning ? t('automation.noTasks') : t('translation.idle')}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Render audit section (special: has action buttons)
    const renderAuditSection = () => {
        const cfg = stageConfig.audit;
        const processingList = Array.from(audit.processingTasks.values());

        return (
            <div className="border-b border-slate-700/50">
                {/* Section header */}
                <div className={`px-3 py-2 bg-gradient-to-r ${cfg.header} flex items-center justify-between`}>
                    <div className="flex items-center gap-2">
                        {audit.isRunning ? (
                            <span className="relative flex h-2 w-2">
                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dotPing} opacity-75`} />
                                <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dot}`} />
                            </span>
                        ) : (
                            <span className="inline-flex rounded-full h-2 w-2 bg-slate-600" />
                        )}
                        <span className={`text-xs font-bold ${cfg.title}`}>{t(cfg.labelKey)}</span>
                        {processingList.length > 0 && (
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
                                {processingList.length}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={audit.onToggle}
                        className={`px-2.5 py-0.5 text-[10px] font-bold rounded-md transition-all text-white ${
                            audit.isRunning ? cfg.btnStop : cfg.btnStart
                        }`}
                    >
                        {audit.isRunning ? t('audit.stopConsumer') : t('audit.startConsumer')}
                    </button>
                </div>

                {/* Processing tasks with action buttons */}
                <div className="p-2 space-y-1.5">
                    {processingList.map(task => {
                        const isThisRemarkOpen = remarkMode?.ticketId === task.ticketId;

                        return (
                            <div
                                key={task.ticketId}
                                className={`p-2.5 rounded-lg border transition-all ${
                                    selectedTicketId === task.ticketId
                                        ? cfg.cardSelected
                                        : cfg.card
                                }`}
                            >
                                {/* Ticket info */}
                                <div
                                    className="cursor-pointer"
                                    onClick={() => onSelectTicket(task.ticketId)}
                                >
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className={`text-[10px] font-black font-mono ${cfg.mono}`}>#{task.externalId}</span>
                                        <div className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-pulse" />
                                    </div>
                                    <div className="text-[10px] text-slate-300 truncate">{task.subject}</div>
                                </div>

                                {/* Action buttons */}
                                <div className="mt-2 flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                                    {/* Pass */}
                                    <button
                                        onClick={() => {
                                            setSubmitting(true);
                                            Promise.resolve(audit.onPass(task.ticketId)).finally(() => setSubmitting(false));
                                        }}
                                        disabled={submitting}
                                        className="px-2.5 py-1 bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-30 text-white text-[10px] font-bold rounded-md transition-all flex items-center gap-0.5"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                        </svg>
                                        {t('audit.pass')}
                                    </button>

                                    {/* Reject */}
                                    <button
                                        onClick={() => openRemarkInput('reject', task.ticketId)}
                                        disabled={submitting}
                                        className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all flex items-center gap-0.5 disabled:opacity-30 ${
                                            isThisRemarkOpen && remarkMode?.type === 'reject'
                                                ? 'bg-red-600 text-white'
                                                : 'bg-red-600/20 text-red-400 hover:bg-red-600/40'
                                        }`}
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                        {t('audit.reject')}
                                    </button>

                                    {/* Retranslate */}
                                    <button
                                        onClick={() => openRemarkInput('retranslate', task.ticketId)}
                                        disabled={submitting}
                                        className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all flex items-center gap-0.5 disabled:opacity-30 ${
                                            isThisRemarkOpen && remarkMode?.type === 'retranslate'
                                                ? 'bg-amber-600 text-white'
                                                : 'bg-amber-600/20 text-amber-400 hover:bg-amber-600/40'
                                        }`}
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                        {t('automation.retranslate')}
                                    </button>

                                    {/* Mobile preview */}
                                    {audit.onMobilePreview && (
                                        <button
                                            onClick={() => audit.onMobilePreview!(task.ticketId)}
                                            disabled={audit.previewLoading === task.ticketId}
                                            className="px-2 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 disabled:opacity-30 text-[10px] font-bold rounded-md transition-all flex items-center gap-0.5 ml-auto"
                                            title={t('audit.mobilePreview')}
                                        >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <rect x="7" y="2" width="10" height="20" rx="2" strokeWidth="2" />
                                                <circle cx="12" cy="18" r="1" fill="currentColor" />
                                            </svg>
                                            {audit.previewLoading === task.ticketId ? '...' : t('audit.mobilePreview')}
                                        </button>
                                    )}
                                </div>

                                {/* Remark input */}
                                {isThisRemarkOpen && (
                                    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                                        <textarea
                                            value={remark}
                                            onChange={(e) => setRemark(e.target.value)}
                                            placeholder={
                                                remarkMode!.type === 'reject'
                                                    ? t('audit.rejectPlaceholder')
                                                    : t('automation.retranslateRemark')
                                            }
                                            className={`w-full bg-black/30 border rounded-lg p-2 text-xs text-white placeholder:text-slate-600 outline-none h-14 resize-none ${
                                                remarkMode!.type === 'reject'
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
                                                    remarkMode!.type === 'reject'
                                                        ? 'bg-rose-600 hover:bg-rose-500'
                                                        : 'bg-amber-600 hover:bg-amber-500'
                                                }`}
                                            >
                                                {submitting
                                                    ? '...'
                                                    : remarkMode!.type === 'reject'
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
                    {processingList.length === 0 && (
                        <div className="text-center py-3 text-slate-600 text-[10px] italic">
                            {audit.isRunning ? t('audit.waitingForTasks') : t('audit.startToAudit')}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Combined completed history
    const allCompleted = React.useMemo(() => {
        const transIds = new Set(Array.from(translation.processingTasks.values()).map(t => t.ticketId));
        const replyIds = new Set(Array.from(reply.processingTasks.values()).map(t => t.ticketId));
        const auditIds = new Set(Array.from(audit.processingTasks.values()).map(t => t.ticketId));

        const items: Array<MQTask & { stage: StageName }> = [
            ...translation.completedHistory.filter(t => !transIds.has(t.ticketId)).map(t => ({ ...t, stage: 'translation' as StageName })),
            ...reply.completedHistory.filter(t => !replyIds.has(t.ticketId)).map(t => ({ ...t, stage: 'reply' as StageName })),
            ...audit.completedHistory.filter(t => !auditIds.has(t.ticketId)).map(t => ({ ...t, stage: 'audit' as StageName })),
        ];

        // Sort by addedAt descending (most recent first)
        items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        return items.slice(0, 20);
    }, [translation.completedHistory, reply.completedHistory, audit.completedHistory,
        translation.processingTasks, reply.processingTasks, audit.processingTasks]);

    return (
        <div className="flex flex-col h-full bg-slate-900/30 overflow-hidden">
            {/* Scrollable stage sections */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {renderStageSection(translation, 'translation')}
                {renderStageSection(reply, 'reply')}
                {renderAuditSection()}
            </div>

            {/* Combined completed history */}
            {allCompleted.length > 0 && (
                <div className="border-t border-slate-700/50 flex-shrink-0">
                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        className="w-full px-3 py-1.5 flex items-center justify-between text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        <span className="font-bold uppercase tracking-wide">
                            {t('automation.completed')} ({allCompleted.length})
                        </span>
                        <svg
                            className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-180' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                    </button>

                    {showHistory && (
                        <div className="px-2 pb-2 space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                            {allCompleted.map((task, idx) => {
                                const cfg = stageConfig[task.stage];
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
                                        key={`${task.stage}-${task.ticketId}-${idx}`}
                                        onClick={() => onSelectTicket(task.ticketId)}
                                        className={`p-1.5 rounded-lg border cursor-pointer transition-all hover:brightness-125 ${statusStyle}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                                <span className={`text-[9px] font-black ${cfg.historyPrefix}`}>{cfg.historyTag}</span>
                                                <span className="text-[10px] font-mono text-slate-500">#{task.externalId}</span>
                                            </div>
                                            <span className="text-[9px] font-bold uppercase">{statusLabel}</span>
                                        </div>
                                        <div className="text-[9px] text-slate-500 truncate pl-5">{task.subject}</div>
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

export default PipelineSidebar;
