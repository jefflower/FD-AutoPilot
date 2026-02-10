import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ServerTicket, TicketStatus } from '../../types/server';
import { LangLabel } from '../Common';

interface ServerTicketListProps {
    tickets: ServerTicket[];
    filteredTickets: ServerTicket[];
    selectedTicket: ServerTicket | null;
    setSelectedTicket: (t: ServerTicket) => void;
    isLoading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    loadTickets: () => void;
    loadMore: () => void;
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    statusFilter: TicketStatus | '';
    setStatusFilter: (f: TicketStatus | '') => void;
    statusCounts: { all: number; open: number; pending: number; resolved: number; closed: number };
    selectedIds: Set<number>;
    toggleSelectAll: () => void;
    toggleTicketSelection: (id: number) => void;
    listLang: 'original' | 'cn' | 'en';
    setListLang: (l: 'original' | 'cn' | 'en') => void;
}

const STATUS_KEYS: { id: TicketStatus | '', key: string, color: string }[] = [
    { id: '', key: 'allStatus', color: 'indigo' },
    { id: 'PENDING_TRANS', key: 'PENDING_TRANS', color: 'yellow' },
    { id: 'TRANSLATING', key: 'TRANSLATING', color: 'blue' },
    { id: 'PENDING_REPLY', key: 'PENDING_REPLY', color: 'orange' },
    { id: 'REPLYING', key: 'REPLYING', color: 'rose' },
    { id: 'PENDING_AUDIT', key: 'PENDING_AUDIT', color: 'purple' },
    { id: 'AUDITING', key: 'AUDITING', color: 'pink' },
    { id: 'COMPLETED', key: 'COMPLETED', color: 'green' },
];

const ServerTicketList: React.FC<ServerTicketListProps> = ({
    tickets,
    filteredTickets,
    selectedTicket,
    setSelectedTicket,
    isLoading,
    loadingMore,
    hasMore,
    loadTickets,
    loadMore,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    statusCounts,
    selectedIds,
    toggleSelectAll,
    toggleTicketSelection,
    listLang,
    setListLang,
}) => {
    const { t } = useTranslation(['tickets', 'common']);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const statusMap = useMemo(() => STATUS_KEYS.map(s => ({
        ...s,
        label: s.key === 'allStatus'
            ? t('common:label.allStatus')
            : t(`common:ticketStatus.${s.key}` as any),
    })), [t]);

    const handleScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container || loadingMore || !hasMore) return;
        const { scrollTop, scrollHeight, clientHeight } = container;
        if (scrollTop + clientHeight >= scrollHeight - 100) {
            loadMore();
        }
    }, [loadMore, loadingMore, hasMore]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (container) {
            container.addEventListener('scroll', handleScroll);
            return () => container.removeEventListener('scroll', handleScroll);
        }
    }, [handleScroll]);

    return (
        <div className="w-1/3 border-r border-white/10 flex flex-col relative h-full bg-slate-900/40">
            <div className="p-4 border-b border-white/10 flex-shrink-0">
                <div className="flex items-center justify-between h-10 mb-4">
                    <div className="flex flex-col">
                        <h1 className="text-lg font-bold text-white leading-tight flex items-center gap-2">
                            {t('list.title')}
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">{t('list.serverBadge')}</span>
                        </h1>
                        <p className="text-slate-400 text-[10px] leading-tight">
                            {isLoading ? t('common:button.loading') : t('list.syncedCount', { count: statusCounts.all })}
                        </p>
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
                            {t('list.selectAll')}
                        </button>

                        <div className="flex bg-slate-950 rounded-lg p-0.5 border border-white/10 h-8">
                            {(['original', 'cn', 'en'] as const).map((l) => (
                                <button
                                    key={l}
                                    onClick={() => { setListLang(l); }}
                                    className={`px-3 py-1 text-xs rounded-md transition-all ${listLang === l ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                                >
                                    {l === 'original' ? t('list.original') : l === 'cn' ? t('list.chinese') : t('list.english')}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={loadTickets}
                            disabled={isLoading}
                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-300 text-sm h-8 flex items-center disabled:opacity-50"
                        >
                            <svg className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {t('common:button.refresh')}
                        </button>
                    </div>
                </div>

                <div className="relative mb-3">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder={t('list.searchPlaceholder')}
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

                <div className="flex gap-1 flex-wrap">
                    {statusMap.map(s => {
                        const isActive = statusFilter === s.id;
                        const colorClass = s.color === 'indigo' ? 'bg-indigo-500 shadow-indigo-500/20' :
                            s.color === 'yellow' ? 'bg-yellow-500 shadow-yellow-500/20' :
                                s.color === 'blue' ? 'bg-blue-500 shadow-blue-500/20' :
                                    s.color === 'orange' ? 'bg-orange-500 shadow-orange-500/20' :
                                        s.color === 'rose' ? 'bg-rose-500 shadow-rose-500/20' :
                                            s.color === 'purple' ? 'bg-purple-500 shadow-purple-500/20' :
                                                s.color === 'pink' ? 'bg-pink-500 shadow-pink-500/20' :
                                                    'bg-green-500 shadow-green-500/20';

                        return (
                            <button
                                key={s.id}
                                onClick={() => setStatusFilter(s.id)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${isActive ? `${colorClass} text-white shadow-lg` : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                            >
                                {s.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative min-h-0 custom-scrollbar">
                {isLoading && tickets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
                        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-indigo-300">{t('list.searching')}</span>
                    </div>
                ) : filteredTickets.length === 0 ? (
                    <div className="p-12 text-center text-slate-500 flex flex-col items-center gap-4">
                        <div className="p-4 bg-white/5 rounded-full">
                            <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <p className="text-sm">{searchQuery ? t('list.noMatchSearch') : t('list.noTicketsInStatus')}</p>
                    </div>
                ) : (
                    <>
                        {filteredTickets.map((ticket) => (
                            <div
                                key={ticket.id}
                                onClick={() => setSelectedTicket(ticket)}
                                className={`group p-3 border-b border-white/5 cursor-pointer transition-all flex gap-3 ${selectedTicket?.id === ticket.id ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500' : 'hover:bg-white/5'}`}
                            >
                                <div
                                    onClick={(e) => { e.stopPropagation(); toggleTicketSelection(ticket.id); }}
                                    className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all ${selectedIds.has(ticket.id) ? 'bg-indigo-500 border-indigo-400' : 'border-white/20 group-hover:border-white/40'}`}
                                >
                                    {selectedIds.has(ticket.id) && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-mono text-slate-500">#{ticket.externalId}</span>
                                            <div className="flex gap-1">
                                                {ticket.translation && <LangLabel lang="cn" />}
                                                {ticket.sourceLang && <LangLabel lang={ticket.sourceLang === 'zh-CN' ? 'cn' : 'en'} />}
                                            </div>
                                        </div>
                                        <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${ticket.status === 'COMPLETED' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                                            ticket.status === 'TRANSLATING' || ticket.status === 'REPLYING' || ticket.status === 'AUDITING' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse' :
                                                'bg-slate-700/50 text-slate-400 border border-white/5'
                                            }`}>
                                            {t(`common:ticketStatus.${ticket.status}` as any)}
                                        </div>
                                    </div>
                                    <h3 className="text-white text-sm font-medium truncate group-hover:text-indigo-300 transition-colors">
                                        {(listLang === 'cn' && ticket.translation) ? ticket.translation.translatedTitle : ticket.subject || t('list.noSubject')}
                                    </h3>
                                    <p className="text-slate-500 text-[11px] mt-1 line-clamp-1 italic">
                                        {ticket.content}
                                    </p>
                                </div>
                            </div>
                        ))}
                        {loadingMore && (
                            <div className="p-4 text-center">
                                <div className="inline-block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                        )}
                        {!hasMore && tickets.length > 0 && (
                            <div className="p-6 text-center text-[10px] text-slate-600 uppercase tracking-widest font-bold">
                                {t('list.endOfRecords')}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default ServerTicketList;
