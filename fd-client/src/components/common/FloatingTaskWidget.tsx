
import React, { useState, useCallback } from 'react';
import { useMQTranslation } from '../../context/MQTranslationContext';
import { useMQReply } from '../../context/MQReplyContext';

export const FloatingTaskWidget: React.FC = () => {
    const [expanded, setExpanded] = useState(false);

    const {
        translationQueue,
        processingTasks: transProcessing,
        completedHistory: transHistory
    } = useMQTranslation();

    const {
        replyQueue,
        processingTasks: replyProcessing,
        completedHistory: replyHistory
    } = useMQReply();

    const totalActive = transProcessing.size + replyProcessing.size + translationQueue.length + replyQueue.length;
    const isRunning = transProcessing.size > 0 || replyProcessing.size > 0;

    const navigateToTask = useCallback((tab: 'translation' | 'reply', ticketId: number) => {
        window.dispatchEvent(new CustomEvent('navigate-to-task', {
            detail: { tab, ticketId }
        }));
        setExpanded(false);
    }, []);

    if (totalActive === 0 && !expanded && transHistory.length === 0 && replyHistory.length === 0) {
        return null;
    }

    const taskItemClass = "cursor-pointer hover:brightness-125 transition-all";

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 font-sans">
            {/* Main Toggle Button */}
            <button
                onClick={() => setExpanded(!expanded)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-full shadow-2xl transition-all border ${isRunning
                    ? 'bg-slate-900/90 text-white border-cyan-500/50 hover:border-cyan-400'
                    : 'bg-slate-800/90 text-slate-300 border-white/10 hover:bg-slate-700'
                    } backdrop-blur-md`}
            >
                <div className="flex items-center gap-2">
                    {isRunning ? (
                        <div className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
                        </div>
                    ) : (
                        <div className="w-2.5 h-2.5 rounded-full bg-slate-500"></div>
                    )}
                    <span className="text-xs font-bold tracking-wide">MQ TASKS</span>
                </div>

                {(totalActive > 0) && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/10 rounded-full">
                        <span className="text-[10px] font-black">{totalActive}</span>
                        <span className="text-[9px] opacity-60 uppercase">Active</span>
                    </div>
                )}

                <svg
                    className={`w-3 h-3 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
            </button>

            {/* Expanded Content */}
            {expanded && (
                <div className="w-80 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-200">

                    {/* Header */}
                    <div className="px-4 py-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Background Jobs</span>
                        <div className="text-[10px] text-slate-500 font-mono">
                            CTX: {transProcessing.size + replyProcessing.size} CPU
                        </div>
                    </div>

                    <div className="flex flex-col max-h-[400px] overflow-y-auto custom-scrollbar">

                        {/* 1. Translation Section */}
                        {(translationQueue.length > 0 || transProcessing.size > 0 || transHistory.length > 0) && (
                            <div className="p-3">
                                <h4 className="flex items-center gap-2 text-[10px] font-bold text-cyan-400 uppercase mb-2">
                                    <span className="w-1 h-3 bg-cyan-500 rounded-full"></span>
                                    Translation Queue
                                </h4>
                                <div className="space-y-1.5">
                                    {/* Active */}
                                    {Array.from(transProcessing.values()).map(task => (
                                        <div
                                            key={task.ticketId}
                                            onClick={() => navigateToTask('translation', task.ticketId)}
                                            className={`${taskItemClass} flex items-center justify-between p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20`}
                                        >
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black font-mono text-cyan-300">#{task.externalId}</span>
                                                    <span className="text-[9px] text-cyan-200/70 truncate max-w-[120px]">{task.subject}</span>
                                                </div>
                                                <span className="text-[9px] text-cyan-500 font-bold animate-pulse mt-0.5">TRANSLATING...</span>
                                            </div>
                                            <div className="w-3 h-3 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
                                        </div>
                                    ))}

                                    {/* Pending */}
                                    {translationQueue.slice(0, 3).map(task => (
                                        <div
                                            key={task.ticketId}
                                            onClick={() => navigateToTask('translation', task.ticketId)}
                                            className={`${taskItemClass} flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5 opacity-60 hover:opacity-100`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-mono text-slate-400">#{task.externalId}</span>
                                                <span className="text-[9px] text-slate-500 truncate max-w-[120px]">{task.subject}</span>
                                            </div>
                                            <span className="text-[9px] text-slate-600 font-bold uppercase">WAITING</span>
                                        </div>
                                    ))}

                                    {/* Recent Completed */}
                                    {transHistory.slice(0, 3).map(task => {
                                        const bg = task.status === 'failed' ? 'bg-red-500/10 border-red-500/20'
                                            : task.status === 'skipped' ? 'bg-amber-500/10 border-amber-500/20'
                                            : 'bg-green-500/5 border-green-500/10';
                                        const labelColor = task.status === 'failed' ? 'text-red-400'
                                            : task.status === 'skipped' ? 'text-amber-500/60'
                                            : 'text-green-500/50';
                                        const label = task.status === 'failed' ? 'FAIL'
                                            : task.status === 'skipped' ? 'SKIP'
                                            : 'DONE';
                                        return (
                                            <div
                                                key={task.ticketId}
                                                onClick={() => navigateToTask('translation', task.ticketId)}
                                                className={`${taskItemClass} flex items-center justify-between p-2 rounded-lg border ${bg}`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-mono text-slate-500">#{task.externalId}</span>
                                                    <span className="text-[9px] text-slate-600 truncate max-w-[120px]">{task.subject}</span>
                                                </div>
                                                <span className={`text-[9px] font-bold uppercase ${labelColor}`}>{label}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Divider */}
                        {((translationQueue.length > 0 || transProcessing.size > 0 || transHistory.length > 0) && (replyQueue.length > 0 || replyProcessing.size > 0 || replyHistory.length > 0)) && (
                            <div className="h-px bg-white/5 mx-4 my-1"></div>
                        )}

                        {/* 2. Reply Section */}
                        {(replyQueue.length > 0 || replyProcessing.size > 0 || replyHistory.length > 0) && (
                            <div className="p-3">
                                <h4 className="flex items-center gap-2 text-[10px] font-bold text-orange-400 uppercase mb-2">
                                    <span className="w-1 h-3 bg-orange-500 rounded-full"></span>
                                    Auto-Reply Queue
                                </h4>
                                <div className="space-y-1.5">
                                    {/* Active */}
                                    {Array.from(replyProcessing.values()).map(task => (
                                        <div
                                            key={task.ticketId}
                                            onClick={() => navigateToTask('reply', task.ticketId)}
                                            className={`${taskItemClass} flex items-center justify-between p-2 rounded-lg bg-orange-500/10 border border-orange-500/20`}
                                        >
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black font-mono text-orange-300">#{task.externalId}</span>
                                                    <span className="text-[9px] text-orange-200/70 truncate max-w-[120px]">{task.subject}</span>
                                                </div>
                                                <span className="text-[9px] text-orange-500 font-bold animate-pulse mt-0.5">GENERATING REPLY...</span>
                                            </div>
                                            <div className="w-3 h-3 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin"></div>
                                        </div>
                                    ))}

                                    {/* Pending */}
                                    {replyQueue.slice(0, 3).map(task => (
                                        <div
                                            key={task.ticketId}
                                            onClick={() => navigateToTask('reply', task.ticketId)}
                                            className={`${taskItemClass} flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5 opacity-60 hover:opacity-100`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-mono text-slate-400">#{task.externalId}</span>
                                                <span className="text-[9px] text-slate-500 truncate max-w-[120px]">{task.subject}</span>
                                            </div>
                                            <span className="text-[9px] text-slate-600 font-bold uppercase">WAITING</span>
                                        </div>
                                    ))}

                                    {/* Recent Completed */}
                                    {replyHistory.slice(0, 3).map(task => {
                                        const bg = task.status === 'failed' ? 'bg-red-500/10 border-red-500/20'
                                            : task.status === 'skipped' ? 'bg-amber-500/10 border-amber-500/20'
                                            : 'bg-green-500/5 border-green-500/10';
                                        const labelColor = task.status === 'failed' ? 'text-red-400'
                                            : task.status === 'skipped' ? 'text-amber-500/60'
                                            : 'text-green-500/50';
                                        const label = task.status === 'failed' ? 'FAIL'
                                            : task.status === 'skipped' ? 'SKIP'
                                            : 'DONE';
                                        return (
                                            <div
                                                key={task.ticketId}
                                                onClick={() => navigateToTask('reply', task.ticketId)}
                                                className={`${taskItemClass} flex items-center justify-between p-2 rounded-lg border ${bg}`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-mono text-slate-500">#{task.externalId}</span>
                                                    <span className="text-[9px] text-slate-600 truncate max-w-[120px]">{task.subject}</span>
                                                </div>
                                                <span className={`text-[9px] font-bold uppercase ${labelColor}`}>{label}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {(totalActive === 0 && transHistory.length === 0 && replyHistory.length === 0) && (
                            <div className="p-8 text-center text-slate-600 text-[10px] italic">
                                No active tasks
                            </div>
                        )}

                    </div>
                </div>
            )}
        </div>
    );
};
