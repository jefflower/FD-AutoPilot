import React from 'react';
import { Ticket } from '../types';
import { StatusBadge, LangLabel } from './Common';

interface TicketListProps {
    tickets: Ticket[];
    filteredTickets: Ticket[];
    selectedTicket: Ticket | null;
    setSelectedTicket: (t: Ticket) => void;
    selectedIds: Set<number>;
    toggleSelectAll: () => void;
    toggleTicketSelection: (id: number) => void;
    listLang: 'original' | 'cn' | 'en';
    setListLang: (l: 'original' | 'cn' | 'en') => void;
    setDisplayLang: (l: 'original' | 'cn' | 'en') => void;
    isLoadingTickets: boolean;
    loadTickets: () => void;
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    statusFilter: number | null;
    setStatusFilter: (f: number | null) => void;
    statusCounts: { all: number; open: number; pending: number; resolved: number; closed: number };
    handleBatchTranslate: (langs: ('cn' | 'en')[]) => void;
    handleBatchExport: () => void;
    batchProgress: { current: number; total: number } | null;
    isAborting: boolean;
    abortBatchRef: React.MutableRefObject<boolean>;
    setIsAborting: (b: boolean) => void;
}

const TicketList: React.FC<TicketListProps> = ({
    tickets,
    filteredTickets,
    selectedTicket,
    setSelectedTicket,
    selectedIds,
    toggleSelectAll,
    toggleTicketSelection,
    listLang,
    setListLang,
    setDisplayLang,
    isLoadingTickets,
    loadTickets,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    statusCounts,
    handleBatchTranslate,
    handleBatchExport,
    batchProgress,
    isAborting,
    abortBatchRef,
    setIsAborting
}) => {
    return (
        <div className="w-1/2 border-r border-white/10 flex flex-col relative h-full">
            {/* Header with search */}
            <div className="p-4 border-b border-white/10 flex-shrink-0">
                <div className="flex items-center justify-between h-10 mb-4">
                    <div className="flex flex-col">
                        <h1 className="text-lg font-bold text-white leading-tight">Tickets</h1>
                        <p className="text-slate-400 text-[10px] leading-tight">{filteredTickets.length} / {tickets.length} shown</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleSelectAll}
                            className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-400 text-[10px] flex items-center gap-1.5 h-8"
                        >
                            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${selectedIds.size > 0 ? 'bg-indigo-500 border-indigo-400' : 'border-white/20'}`}>
                                {selectedIds.size === filteredTickets.length && filteredTickets.length > 0 && (
                                    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                )}
                                {selectedIds.size > 0 && selectedIds.size < filteredTickets.length && (
                                    <div className="w-1.5 h-0.5 bg-white rounded-full" />
                                )}
                            </div>
                            All
                        </button>

                        <div className="flex bg-slate-950 rounded-lg p-0.5 border border-white/10 h-8">
                            {(['original', 'cn', 'en'] as const).map((l) => (
                                <button
                                    key={l}
                                    onClick={() => { setListLang(l); }}
                                    className={`px-3 py-1 text-xs rounded-md transition-all ${listLang === l ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                                >
                                    {l === 'original' ? 'Original' : l === 'cn' ? '中文' : 'English'}
                                </button>
                            ))}
                        </div>
                        <button onClick={loadTickets} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-300 text-sm h-8 flex items-center">Refresh</button>
                    </div>
                </div>

                {/* Search input */}
                <div className="relative mb-3">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search subject, description, conversations..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    )}
                </div>

                {/* Status filter tabs */}
                <div className="flex gap-1 flex-wrap">
                    <button
                        onClick={() => setStatusFilter(null)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${statusFilter === null ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                    >All <span className="bg-white/20 px-1.5 rounded">{statusCounts.all}</span></button>
                    {[
                        { id: 2, label: 'Open', color: 'bg-green-500', count: statusCounts.open },
                        { id: 3, label: 'Pending', color: 'bg-yellow-500', count: statusCounts.pending },
                        { id: 4, label: 'Resolved', color: 'bg-blue-500', count: statusCounts.resolved },
                        { id: 5, label: 'Closed', color: 'bg-gray-500', count: statusCounts.closed },
                    ].map(s => (
                        <button
                            key={s.id}
                            onClick={() => setStatusFilter(s.id)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${statusFilter === s.id ? `${s.color} text-white` : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                        >
                            {s.label} <span className="bg-white/20 px-1.5 rounded">{s.count}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Ticket list */}
            <div className="flex-1 overflow-y-auto relative min-h-0">
                {filteredTickets.length === 0 ? (
                    <div className="p-4 text-center text-slate-500">
                        {searchQuery ? 'No tickets match your search' : 'No tickets found'}
                    </div>
                ) : (
                    filteredTickets.map((t) => (
                        <div
                            key={t.id}
                            onClick={() => { setSelectedTicket(t); setDisplayLang(listLang); }}
                            className={`group p-3 border-b border-white/5 cursor-pointer transition-all flex gap-3 ${selectedTicket?.id === t.id ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500' : 'hover:bg-white/5'}`}
                        >
                            <div
                                onClick={(e) => { e.stopPropagation(); toggleTicketSelection(t.id); }}
                                className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all ${selectedIds.has(t.id) ? 'bg-indigo-500 border-indigo-400' : 'border-white/20 group-hover:border-white/40'}`}
                            >
                                {selectedIds.has(t.id) && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-500">#{t.id}</span>
                                        <div className="flex gap-1">
                                            {t.available_langs?.map(l => <LangLabel key={l} lang={l} />)}
                                        </div>
                                    </div>
                                    <StatusBadge status={t.status} />
                                </div>
                                <h3 className="text-white text-sm font-medium truncate">{t.subject || '(No Subject)'}</h3>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Batch Action Bar */}
            {selectedIds.size > 0 && !batchProgress && (
                <div className="absolute bottom-4 left-4 right-4 bg-indigo-600 rounded-xl shadow-2xl shadow-indigo-500/40 p-3 flex flex-col gap-3 z-30 animate-in fade-in slide-in-from-bottom-4 duration-300 border border-indigo-400/30">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-white font-bold text-xs">
                                {selectedIds.size}
                            </div>
                            <div className="flex flex-col">
                                <span className="text-white text-xs font-bold leading-tight">Tickets Selected</span>
                                <button onClick={() => toggleSelectAll()} className="text-indigo-200 text-[10px] hover:text-white transition-colors text-left">Deselect all</button>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            onClick={() => handleBatchTranslate(['cn'])}
                            className="px-2 py-1.5 bg-white text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-50 transition-all flex items-center justify-center gap-1.5"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>
                            CN
                        </button>
                        <button
                            onClick={() => handleBatchTranslate(['en'])}
                            className="px-2 py-1.5 bg-indigo-500 text-white border border-indigo-400 rounded-lg text-xs font-bold hover:bg-indigo-400 transition-all flex items-center justify-center gap-1.5"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>
                            EN
                        </button>
                        <button
                            onClick={() => handleBatchTranslate(['cn', 'en'])}
                            className="px-2 py-1.5 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg text-xs font-bold hover:from-blue-400 hover:to-purple-400 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-blue-500/20"
                        >
                            CN & EN
                        </button>
                    </div>
                    <button
                        onClick={handleBatchExport}
                        className="w-full py-2 bg-indigo-500/50 hover:bg-indigo-400 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 border border-indigo-400/50"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        Export to CSV (.csv)
                    </button>
                </div>
            )}

            {isLoadingTickets && !batchProgress && (
                <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] z-40 flex items-center justify-center rounded-r-lg">
                    <div className="flex flex-col items-center gap-2">
                        <svg className="animate-spin h-6 w-6 text-indigo-400" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span className="text-xs text-indigo-300 font-medium">Loading tickets...</span>
                    </div>
                </div>
            )}

            {batchProgress && (
                <div className="absolute inset-0 bg-indigo-900/40 backdrop-blur-md z-50 flex items-center justify-center p-6 rounded-r-lg">
                    <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-6 w-full max-w-sm shadow-2xl overflow-hidden relative">
                        <div className="absolute top-0 left-0 h-1 bg-indigo-500 transition-all duration-300" style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-white font-bold">Batch Processing</h3>
                                <p className="text-slate-400 text-xs">Translating via Gemini AI</p>
                            </div>
                            <span className="text-indigo-400 font-mono text-sm font-bold">{Math.round((batchProgress.current / batchProgress.total) * 100)}%</span>
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-4">
                            <div
                                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                            />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-4">
                            <span>Task {batchProgress.current} of {batchProgress.total}</span>
                            <span className="animate-pulse">Please wait...</span>
                        </div>
                        <button
                            onClick={() => {
                                abortBatchRef.current = true;
                                setIsAborting(true);
                            }}
                            disabled={isAborting}
                            className={`w-full py-2 border text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${isAborting ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed' : 'bg-red-500/20 hover:bg-red-500/30 border-red-500/30 text-red-400'}`}
                        >
                            {isAborting ? (
                                <>
                                    <svg className="animate-spin h-3.5 w-3.5 text-slate-500" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Stopping...
                                </>
                            ) : (
                                <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    Abort Process
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TicketList;
