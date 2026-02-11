import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ticketApi } from '../../services/serverApi';
import ServerTicketDetail from './ServerTicketDetail';
import type { ServerTicket, TicketStatus, TicketQueryParams } from '../../types/server';
import { getTicketStatusOptions } from '../../utils/statusLabels';

interface ServerTicketsTabProps {
    isAdmin: boolean;
}

const ServerTicketsTab: React.FC<ServerTicketsTabProps> = ({
    isAdmin: _isAdmin
}) => {
    const { t } = useTranslation(['tickets', 'common']);
    const statusOptions = useMemo(() => getTicketStatusOptions(t), [t]);

    const [tickets, setTickets] = useState<ServerTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);

    // 查询参数
    const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [hasMore, setHasMore] = useState(true);

    // 语言与显示偏好 (从 localStorage 加载以保持跨页面一致性)
    const [displayLang, setDisplayLangState] = useState<'original' | 'cn' | 'en'>(() => {
        return (localStorage.getItem('server_display_lang') as 'original' | 'cn' | 'en') || 'cn';
    });
    const [isSplitMode, setIsSplitModeState] = useState<boolean>(() => {
        const saved = localStorage.getItem('server_split_mode');
        return saved !== null ? saved === 'true' : true; // 默认开启分栏
    });

    const setDisplayLang = (l: 'original' | 'cn' | 'en') => {
        setDisplayLangState(l);
        localStorage.setItem('server_display_lang', l);
    };

    const setIsSplitMode = (s: boolean) => {
        setIsSplitModeState(s);
        localStorage.setItem('server_split_mode', s.toString());
    };

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isFetchingRef = useRef(false);
    const requestIdRef = useRef(0);
    const pageRef = useRef(0); // 使用 Ref 记录当前页码，避免触发函数重建

    const loadTickets = useCallback(async (reset = true, targetPage?: number) => {
        if (!reset && isFetchingRef.current) return;

        const currentRequestId = ++requestIdRef.current;
        isFetchingRef.current = true;

        if (reset) {
            setLoading(true);
            pageRef.current = 0; // 重置时页码归零
        } else {
            setLoadingMore(true);
        }
        setError(null);

        try {
            const fetchPage = reset ? 0 : (targetPage ?? (pageRef.current + 1));
            const params: TicketQueryParams = {
                page: fetchPage,
                size: 30,
            };
            if (statusFilter) params.status = statusFilter;
            if (searchQuery.trim()) params.subject = searchQuery.trim();

            const result = await ticketApi.getTickets(params);

            // 如果请求 ID 不一致，说明有新请求，丢弃当前结果
            if (currentRequestId !== requestIdRef.current) return;

            if (reset) {
                setTickets(result.content);
                // 默认选中第一个 (使用函数式更新避免依赖 selectedId)
                setSelectedId(prev => {
                    if (!prev && result.content.length > 0) {
                        return result.content[0].id;
                    }
                    return prev;
                });
            } else {
                setTickets(prev => [...prev, ...result.content]);
            }

            setHasMore(result.number + 1 < result.totalPages);
            pageRef.current = result.number; // 更新 Ref
        } catch (err) {
            if (currentRequestId === requestIdRef.current) {
                setError(err instanceof Error ? err.message : t('list.loadFailed'));
            }
        } finally {
            if (currentRequestId === requestIdRef.current) {
                isFetchingRef.current = false;
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [statusFilter, searchQuery, t]);

    // 详情页引用
    const detailRef = useRef<any>(null);

    // 核心数据加载
    useEffect(() => {
        loadTickets(true);
    }, [statusFilter, searchQuery, loadTickets]);

    // MQ 事件处理: 响应来自父组件的调度信号


    // 详情加载与自动滚动
    useEffect(() => {
        if (selectedId) {
            ticketApi.getTicketById(selectedId)
                .then(setSelectedTicket)
                .catch(err => console.error('Failed to load details:', err));

            // 自动滚动到选中项
            setTimeout(() => {
                const element = document.getElementById(`ticket-item-${selectedId}`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 100);
        } else {
            setSelectedTicket(null);
        }
    }, [selectedId]);

    const handleScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container || isFetchingRef.current || !hasMore) return;
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 100) {
            loadTickets(false);
        }
    }, [loadTickets, hasMore]);

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧列表 */}
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                {/* 头部对齐 MQ 风格 */}
                <div className="p-4 border-b border-white/10 bg-gradient-to-br from-indigo-900/40 to-slate-900/20">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                            <span className="w-1 h-3 bg-indigo-500 rounded-full"></span>
                            {t('list.title')}
                        </h3>
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-indigo-500/20 text-indigo-400 border border-indigo-500/30`}>
                            {t('list.active')}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
                            <button
                                onClick={() => setDisplayLang('original')}
                                className={`flex-1 py-1 text-[10px] font-bold rounded-md transition-all ${displayLang === 'original' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                {t('list.original')}
                            </button>
                            <button
                                onClick={() => setDisplayLang('cn')}
                                className={`flex-1 py-1 text-[10px] font-bold rounded-md transition-all ${displayLang === 'cn' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                {t('list.chinese')}
                            </button>
                        </div>

                        <div className="relative group">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t('list.searchPlaceholder')}
                                className="w-full pl-8 pr-3 py-1.5 bg-black/40 border border-white/5 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-all"
                            />
                            <svg className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>
                </div>

                {/* 状态筛选 - 横向滚动胶囊 */}
                <div className="p-2 border-b border-white/10 bg-slate-900/40">
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar-hidden no-scrollbar">
                        {statusOptions.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setStatusFilter(opt.value as TicketStatus | '')}
                                className={`flex-shrink-0 px-3 py-1 rounded-full text-[10px] font-bold transition-all border ${statusFilter === opt.value
                                    ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400'
                                    : 'bg-white/5 border-transparent text-slate-500 hover:bg-white/10 hover:text-slate-300'
                                    }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 滚动列表 */}
                <div
                    ref={scrollContainerRef}
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1"
                >
                    {tickets.map(ticket => (
                        <button
                            key={ticket.id}
                            id={`ticket-item-${ticket.id}`}
                            onClick={() => setSelectedId(ticket.id)}
                            className={`w-full text-left p-2.5 rounded-lg transition-all border group ${selectedId === ticket.id
                                ? 'bg-indigo-500/10 border-indigo-500/30 shadow-lg shadow-indigo-500/5'
                                : 'bg-white/5 border-transparent hover:bg-white/10'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-bold text-indigo-400/60 group-hover:text-indigo-400 transition-opacity">#{ticket.externalId}</span>
                                <span className={`px-1.5 py-0.5 rounded-[4px] text-[8px] font-black uppercase tracking-tighter ${statusOptions.find(o => o.value === ticket.status)?.color
                                    }`}>
                                    {statusOptions.find(o => o.value === ticket.status)?.label || ticket.status}
                                </span>
                            </div>
                            <div className="text-[11px] text-slate-300 truncate font-medium group-hover:text-white transition-colors">
                                {(displayLang === 'cn' && (ticket.translatedTitle || ticket.translation?.translatedTitle)) ? (ticket.translatedTitle || ticket.translation?.translatedTitle) : ticket.subject}
                            </div>
                        </button>
                    ))}

                    {error && (
                        <div className="m-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400 font-bold">
                            ⚠️ {error}
                        </div>
                    )}

                    {loadingMore && (
                        <div className="flex justify-center p-4">
                            <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                        </div>
                    )}

                    {!loading && tickets.length === 0 && (
                        <div className="text-center py-12 text-slate-600 text-[10px] italic">{t('list.noData')}</div>
                    )}
                </div>
            </div>

            {/* 右侧详情 */}
            <div className="flex-1 bg-slate-900/40 relative">
                {selectedTicket ? (
                    <ServerTicketDetail
                        ref={detailRef}
                        ticket={selectedTicket}
                        isEmbed={true}
                        isSplitMode={isSplitMode}
                        setIsSplitMode={setIsSplitMode}
                        onRefresh={() => loadTickets(true)}
                    />
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600">
                        <div className="text-sm font-medium">{t('list.selectTicketHint')}</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ServerTicketsTab;
