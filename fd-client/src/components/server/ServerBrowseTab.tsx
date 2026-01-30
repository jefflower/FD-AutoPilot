import React, { useState, useEffect, useCallback } from 'react';
import { serverApi } from '../../services/serverApi';
import type { ServerTicket, TicketStatus, TicketQueryParams } from '../../types/server';
import ServerTicketList from './ServerTicketList';
import ServerTicketDetail from './ServerTicketDetail';

const ServerBrowseTab: React.FC = () => {
    // 基础状态
    const [tickets, setTickets] = useState<ServerTicket[]>([]);
    const [filteredTickets, setFilteredTickets] = useState<ServerTicket[]>([]); // 虽由 API 过滤，但需同步
    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);

    // 查询参数
    const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);

    // 预览语言
    const [displayLang, setDisplayLang] = useState<'original' | 'cn' | 'en'>('original');
    const [listLang, setListLang] = useState<'original' | 'cn' | 'en'>('original');

    // 多选状态
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    const toggleTicketSelection = (id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredTickets.length && filteredTickets.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredTickets.map(t => t.id)));
        }
    };

    // 状态统计 (简化版，可由后端聚合)
    const [statusCounts, setStatusCounts] = useState({
        all: 0, open: 0, pending: 0, resolved: 0, closed: 0
    });

    // 加载数据
    const loadTickets = useCallback(async (reset = true) => {
        const nextPage = reset ? 0 : page + 1;
        if (reset) {
            setIsLoading(true);
            setSelectedIds(new Set()); // 重置时清除选中
        } else {
            setLoadingMore(true);
        }

        try {
            const params: TicketQueryParams = {
                page: nextPage,
                size: 20,
            };
            if (statusFilter) params.status = statusFilter;
            if (searchQuery.trim()) params.subject = searchQuery.trim();

            const result = await serverApi.ticket.getTickets(params);

            if (reset) {
                setTickets(result.content);
                setFilteredTickets(result.content);
                setPage(0);
                // 总数统计
                setStatusCounts(prev => ({ ...prev, all: result.totalElements }));
            } else {
                setTickets(prev => [...prev, ...result.content]);
                setFilteredTickets(prev => [...prev, ...result.content]);
                setPage(nextPage);
            }

            setHasMore(nextPage + 1 < result.totalPages);
        } catch (err) {
            console.error('Failed to load tickets:', err);
        } finally {
            setIsLoading(false);
            setLoadingMore(false);
        }
    }, [page, statusFilter, searchQuery, filteredTickets.length]);

    useEffect(() => {
        loadTickets(true);
    }, [statusFilter, searchQuery]);

    // 详情选择处理
    const handleSelectTicket = (ticket: ServerTicket) => {
        setSelectedTicket(ticket);
        setDisplayLang(listLang); // 跟随列表预览选项
    };

    return (
        <div className="flex-1 flex overflow-hidden relative">
            <ServerTicketList
                tickets={tickets}
                filteredTickets={filteredTickets}
                selectedTicket={selectedTicket}
                setSelectedTicket={handleSelectTicket}
                isLoading={isLoading}
                loadingMore={loadingMore}
                hasMore={hasMore}
                loadTickets={() => loadTickets(true)}
                loadMore={() => loadTickets(false)}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                statusFilter={statusFilter}
                setStatusFilter={(f: any) => setStatusFilter(f)}
                statusCounts={statusCounts}
                selectedIds={selectedIds}
                toggleSelectAll={toggleSelectAll}
                toggleTicketSelection={toggleTicketSelection}
                listLang={listLang}
                setListLang={setListLang}
            />

            <div className="flex-1 flex flex-col bg-slate-800/30 overflow-hidden">
                {selectedTicket ? (
                    <ServerTicketDetail
                        ticket={selectedTicket}
                        displayLang={displayLang}
                        setDisplayLang={setDisplayLang}
                        onRefresh={() => loadTickets(true)}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-500 flex-col gap-4">
                        <svg className="w-16 h-16 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        <p>请选择一个工单进行查看</p>
                    </div>
                )}
            </div>
            {/* Batch Action Bar: 对齐本地工单体验 */}
            {selectedIds.size > 0 && (
                <div className="absolute bottom-6 left-6 right-6 lg:left-12 lg:right-auto lg:w-96 bg-indigo-600 rounded-2xl shadow-2xl shadow-indigo-500/40 p-4 flex flex-col gap-3 z-30 animate-in fade-in slide-in-from-bottom-6 duration-300 border border-indigo-400/30">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white font-bold text-sm">
                                {selectedIds.size}
                            </div>
                            <div className="flex flex-col">
                                <span className="text-white text-sm font-bold leading-tight">服务端工单已选中</span>
                                <button onClick={() => setSelectedIds(new Set())} className="text-indigo-200 text-[10px] hover:text-white transition-colors text-left uppercase tracking-wider font-bold mt-0.5">取消全选</button>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={() => alert(`准备批量同步 ${selectedIds.size} 个工单...`)}
                            className="px-3 py-2 bg-white text-indigo-600 rounded-xl text-xs font-bold hover:bg-indigo-50 transition-all flex items-center justify-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            同步数据
                        </button>
                        <button
                            onClick={() => alert(`准备批量导出 ${selectedIds.size} 个工单...`)}
                            className="px-3 py-2 bg-indigo-500 text-white border border-indigo-400 rounded-xl text-xs font-bold hover:bg-indigo-400 transition-all flex items-center justify-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            导出 CSV
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ServerBrowseTab;
