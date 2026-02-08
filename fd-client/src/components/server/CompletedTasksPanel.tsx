import React from 'react';

interface CompletedTicket {
    ticketId: number;
    externalId: string;
    subject: string;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    success: boolean;
    errorMessage: string | null;
}

interface CompletedTasksPanelProps {
    completedTasks: CompletedTicket[];
    selectedId: number | null;
    onSelectTask: (id: number) => void;
    onClearList?: () => void;
}

const CompletedTasksPanel: React.FC<CompletedTasksPanelProps> = ({
    completedTasks,
    selectedId,
    onSelectTask,
    onClearList: _onClearList
}) => {
    return (
        <div className="flex flex-col h-full bg-slate-900/20 border-l border-white/10 w-72 flex-shrink-0">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-white/10 bg-gradient-to-br from-green-900/20 to-slate-900/20 h-[52px]">
                <h3 className="font-bold text-slate-400 text-xs tracking-wide flex items-center gap-2">
                    <span className="w-1 h-3 bg-green-500 rounded-full"></span>
                    COMPLETED
                    <span className="bg-white/5 text-slate-500 px-1.5 py-0.5 rounded text-[9px] font-mono">
                        {completedTasks.length}
                    </span>
                </h3>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                {completedTasks.map(task => (
                    <button
                        key={task.ticketId}
                        onClick={() => onSelectTask(task.ticketId)}
                        className={`w-full text-left p-2.5 rounded-lg transition-all border group relative ${selectedId === task.ticketId
                            ? 'bg-green-500/10 border-green-500/30 shadow-lg shadow-green-900/20 z-10'
                            : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/5'
                            }`}
                    >
                        <div className="flex items-start justify-between mb-1">
                            <span className={`text-[11px] font-black font-mono tracking-tight ${selectedId === task.ticketId ? 'text-green-400' : 'text-slate-400 group-hover:text-slate-300'
                                }`}>
                                #{task.externalId}
                            </span>
                            <div className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${task.success
                                ? 'bg-green-500/20 text-green-400 border border-green-500/20'
                                : 'bg-red-500/20 text-red-400 border border-red-500/20'
                                }`}>
                                {task.success ? 'SUCCESS' : 'FAILED'}
                            </div>
                        </div>

                        <div className="text-[10px] text-slate-400 truncate font-medium mb-1.5 group-hover:text-slate-200 transition-colors">
                            {task.subject}
                        </div>

                        <div className="flex items-center justify-between text-[9px] text-slate-600 font-mono">
                            <span>{(task.durationMs / 1000).toFixed(1)}s</span>
                            <span>{new Date(task.completedAt).toLocaleTimeString()}</span>
                        </div>

                        {selectedId === task.ticketId && (
                            <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-green-500 rounded-r-lg"></div>
                        )}
                    </button>
                ))}

                {completedTasks.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-600 space-y-2 opacity-50">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        <span className="text-[10px] italic">No completed tasks yet</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CompletedTasksPanel;
