import React from 'react';
import { Progress as ProgressType } from '../types';

interface SyncTabProps {
    isSyncing: boolean;
    progress: ProgressType | null;
    fullSync: boolean;
    setFullSync: (b: boolean) => void;
    syncStartDate: string;
    startSync: () => void;
    syncStatuses: () => void;
    logs: string[];
    logsEndRef: React.RefObject<HTMLDivElement | null>;
}

const SyncTab: React.FC<SyncTabProps> = ({
    isSyncing,
    progress,
    fullSync,
    setFullSync,
    syncStartDate,
    startSync,
    syncStatuses,
    logs,
    logsEndRef
}) => {
    return (
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
            <div className="mb-4">
                <h1 className="text-2xl font-bold text-white">Sync Tickets</h1>
                <p className="text-slate-400 text-sm">Synchronize tickets from Freshdesk</p>
            </div>

            {/* Sync Mode Toggle */}
            <div className="bg-white/5 rounded-xl border border-white/10 p-4 mb-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-white font-medium">Full Sync Mode</h3>
                        <p className="text-slate-400 text-xs">Download all tickets from {syncStartDate}</p>
                    </div>
                    <button
                        onClick={() => setFullSync(!fullSync)}
                        disabled={isSyncing}
                        className={`relative w-14 h-7 rounded-full transition-colors ${fullSync ? 'bg-indigo-500' : 'bg-slate-600'} ${isSyncing ? 'opacity-50' : ''}`}
                    >
                        <span className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${fullSync ? 'left-8' : 'left-1'}`} />
                    </button>
                </div>
                {fullSync && (
                    <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                        <p className="text-yellow-400 text-xs">⚠️ Full sync from {syncStartDate}. Change start date in Settings if needed.</p>
                    </div>
                )}
            </div>

            {/* Progress Bar */}
            {isSyncing && progress && (
                <div className="bg-white/5 rounded-xl border border-white/10 p-4 mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-medium text-sm">
                            {progress.phase === 'fetching' && '📥 Fetching tickets...'}
                            {progress.phase === 'processing' && `⚙️ Processing: ${progress.processed}/${progress.totalTickets}`}
                            {progress.phase === 'complete' && '✅ Complete!'}
                            {progress.phase === 'starting' && '🚀 Starting...'}
                        </span>
                        <span className="text-indigo-400 font-mono text-sm">{progress.current}%</span>
                    </div>
                    <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                            style={{ width: `${progress.current}%` }}
                        />
                    </div>
                    {progress.ticketId && (
                        <p className="text-slate-500 text-xs mt-2">Current: Ticket #{progress.ticketId}</p>
                    )}
                </div>
            )}

            <button
                onClick={startSync}
                disabled={isSyncing}
                className={`w-full py-4 rounded-xl font-semibold text-white transition-all duration-300 flex items-center justify-center gap-3 mb-2 ${isSyncing ? 'bg-slate-700 cursor-not-allowed' : fullSync ? 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 shadow-lg shadow-orange-500/25' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-500/25'
                    }`}
            >
                {isSyncing ? (
                    <><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Syncing...</>
                ) : (
                    <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>{fullSync ? 'Start Full Sync' : 'Start Incremental Sync'}</>
                )}
            </button>

            <button
                onClick={syncStatuses}
                disabled={isSyncing}
                className="w-full py-3 rounded-xl font-medium text-slate-300 transition-all duration-300 flex items-center justify-center gap-2 mb-4 bg-slate-700/50 border border-white/10 hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" /></svg>
                Sync File Statuses
            </button>

            {/* Console */}
            <div className="flex-1 bg-slate-950 rounded-xl border border-white/10 overflow-hidden flex flex-col min-h-0">
                <div className="px-4 py-2 border-b border-white/10 flex items-center gap-2 flex-shrink-0">
                    <div className="flex gap-1.5 focus:outline-none">
                        <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                        <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                        <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                    </div>
                    <span className="text-sm text-slate-400 ml-2">Console</span>
                    <span className="text-xs text-slate-600 ml-auto">{logs.length} lines</span>
                </div>
                <div className="flex-1 p-4 overflow-y-auto font-mono text-xs bg-slate-950">
                    {logs.length === 0 ? (
                        <p className="text-slate-500">Ready to sync...</p>
                    ) : (
                        logs.map((log, i) => (
                            <div key={i} className={`py-0.5 ${log.includes('Error') || log.includes('❌') ? 'text-red-400' : log.includes('✅') ? 'text-green-400' : log.includes('⚠️') ? 'text-yellow-400' : 'text-slate-300'}`}>
                                {log}
                            </div>
                        ))
                    )}
                    <div ref={logsEndRef} />
                </div>
            </div>
        </div>
    );
};

export default SyncTab;
