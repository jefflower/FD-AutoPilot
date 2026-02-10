import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { serverApi } from '../../services/serverApi';
import ServerTaskWorkspace from './ServerTaskWorkspace';
import { useMQReply } from '../../context/MQReplyContext';

interface ReplyTasksTabProps {
    initialSelectedId?: number | null;
    onNavigated?: () => void;
}

const ReplyTasksTab: React.FC<ReplyTasksTabProps> = ({ initialSelectedId, onNavigated }) => {
    const { t } = useTranslation(['tasks', 'common']);
    const {
        processingTasks,
        completedHistory,
        isRunning,
        startConsumer,
        stopConsumer,
        logs
    } = useMQReply();

    const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId ?? null);

    // 处理外部导航（来自 FloatingTaskWidget）
    useEffect(() => {
        if (initialSelectedId) {
            setSelectedId(initialSelectedId);
            onNavigated?.();
        }
    }, [initialSelectedId, onNavigated]);

    const handleLoadTicket = useCallback(async (ticketId: number) => {
        return await serverApi.ticket.getTicketById(ticketId);
    }, []);

    const processingList = Array.from(processingTasks.values());
    const processingTicketIds = new Set(processingList.map(t => t.ticketId));

    // 过滤 completedHistory：排除正在处理中的 ticketId（防止重试时 key 冲突）
    const filteredCompletedHistory = completedHistory.filter(t => !processingTicketIds.has(t.ticketId));

    const workspaceReplyTasks = processingList.map(t => ({
        ticketId: t.ticketId,
        externalId: t.externalId,
        subject: t.subject,
        startedAt: t.addedAt,
        isProcessed: false
    }));

    const workspaceCompletedTasks = filteredCompletedHistory.map(t => ({
        ticketId: t.ticketId,
        externalId: t.externalId,
        subject: t.subject,
        startedAt: t.addedAt,
        completedAt: t.addedAt,
        success: t.status === 'completed' || t.status === 'skipped',
        isProcessed: true
    }));

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                <div className="p-4 border-b border-white/10 bg-gradient-to-br from-orange-900/40 to-red-900/20">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                            <span className="w-1 h-3 bg-orange-500 rounded-full"></span>
                            {t('reply.title')}
                        </h3>
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${isRunning
                            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                            : 'bg-slate-800 text-slate-500 border border-white/5'
                            }`}>
                            {isRunning ? t('reply.statusRunning') : t('reply.statusStopped')}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex gap-2">
                            {!isRunning ? (
                                <button
                                    onClick={() => startConsumer()}
                                    className="flex-1 h-9 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-orange-900/20 transition-all flex items-center justify-center gap-2"
                                >
                                    {t('reply.startConsumer')}
                                </button>
                            ) : (
                                <button
                                    onClick={() => stopConsumer()}
                                    className="flex-1 h-9 bg-red-500/80 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                                >
                                    {t('reply.stopConsumer')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-4">
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                {processingList.length > 0 && <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-ping"></span>}
                                {t('reply.processing')}
                            </h4>
                            <span className="text-[10px] font-mono text-orange-500/50">({processingList.length})</span>
                        </div>

                        <div className="space-y-1">
                            {processingList.map(task => (
                                <button
                                    key={task.ticketId}
                                    onClick={() => setSelectedId(task.ticketId)}
                                    className={`w-full text-left p-2.5 rounded-lg transition-all border group relative ${selectedId === task.ticketId
                                        ? 'bg-orange-500/10 border-orange-500/30 shadow-lg shadow-orange-500/5 z-10'
                                        : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/5'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[11px] font-bold font-mono text-orange-400 opacity-80 group-hover:opacity-100 transition-opacity">#{task.externalId}</span>
                                        <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse"></div>
                                    </div>
                                    <div className="text-[11px] text-slate-300 truncate font-medium group-hover:text-white transition-colors">{task.subject}</div>

                                    {selectedId === task.ticketId && (
                                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-orange-500 rounded-l-lg"></div>
                                    )}
                                </button>
                            ))}

                            {processingList.length === 0 && (
                                <div className="text-center py-6 text-slate-600 text-[10px] italic border border-dashed border-white/5 rounded-xl">{t('reply.idle')}</div>
                            )}
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between px-2 mb-2 mt-4">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">{t('reply.completed')}</h4>
                            <span className="text-[10px] font-mono text-green-500/50">({filteredCompletedHistory.length})</span>
                        </div>
                        <div className="space-y-1">
                            {filteredCompletedHistory.map(task => {
                                const statusColor = task.status === 'skipped'
                                    ? 'text-amber-500/50'
                                    : task.status === 'completed'
                                        ? 'text-green-500/50'
                                        : 'text-red-500/50';
                                const statusLabel = task.status === 'skipped'
                                    ? t('reply.statusSkipped')
                                    : task.status === 'completed'
                                        ? t('reply.statusDone')
                                        : t('reply.statusFailed');
                                const borderColor = task.status === 'skipped'
                                    ? 'bg-amber-500/10 border-amber-500/30'
                                    : 'bg-green-500/10 border-green-500/30';

                                return (
                                    <button
                                        key={task.ticketId}
                                        onClick={() => setSelectedId(task.ticketId)}
                                        className={`w-full text-left p-2 rounded-lg transition-all border group ${selectedId === task.ticketId
                                            ? borderColor
                                            : 'bg-white/5 border-transparent hover:bg-white/10'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-[10px] font-bold text-slate-500 opacity-60 group-hover:opacity-100 transition-opacity">#{task.externalId}</span>
                                            <span className={`text-[9px] font-black uppercase tracking-tighter ${statusColor}`}>
                                                {statusLabel}
                                            </span>
                                        </div>
                                        <div className="text-[11px] text-slate-400 truncate group-hover:text-slate-200 transition-colors">{task.subject}</div>
                                    </button>
                                );
                            })}
                            {filteredCompletedHistory.length === 0 && (
                                <div className="text-center py-6 text-slate-600 text-[10px] italic border border-dashed border-white/5 rounded-xl">{t('reply.noCompleted')}</div>
                            )}
                        </div>
                    </div>
                </div>

                {logs.length > 0 && (
                    <div className="h-16 bg-black/40 border-t border-white/10 overflow-y-auto p-2 text-[9px] font-mono text-slate-500">
                        {logs.slice(-3).map((log, i) => (
                            <div key={i} className="truncate">{log}</div>
                        ))}
                    </div>
                )}
            </div>

            {/* 右侧工作区：多标签页 */}
            <ServerTaskWorkspace
                type="reply"
                translatingTasks={workspaceReplyTasks}
                completedTasks={workspaceCompletedTasks}
                selectedTaskId={selectedId}
                onSelectTask={setSelectedId}
                onLoadTicket={handleLoadTicket}
                onRefresh={() => {}}
            />
        </div>
    );
};

export default ReplyTasksTab;
