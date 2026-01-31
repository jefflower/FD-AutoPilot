import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ticketApi } from '../../services/serverApi';
import ServerTicketDetail from './ServerTicketDetail';
import { invoke } from '@tauri-apps/api/core';
import type { ServerTicket, TicketStatus, TicketQueryParams } from '../../types/server';

interface ServerTicketsTabProps {
    isAdmin: boolean;
    mqTarget?: { id: number; type: 'translate' | 'reply' } | null;
    onMqTargetHandled?: () => void;
}

const STATUS_OPTIONS: { value: TicketStatus | ''; label: string; color: string }[] = [
    { value: '', label: '全部状态', color: 'bg-slate-500' },
    { value: 'PENDING_TRANS', label: '待翻译', color: 'bg-yellow-500/20 text-yellow-500' },
    { value: 'TRANSLATING', label: '翻译中', color: 'bg-blue-500/20 text-blue-500' },
    { value: 'PENDING_REPLY', label: '待回复', color: 'bg-orange-500/20 text-orange-500' },
    { value: 'REPLYING', label: '回复中', color: 'bg-purple-500/20 text-purple-500' },
    { value: 'PENDING_AUDIT', label: '待审核', color: 'bg-pink-500/20 text-pink-500' },
    { value: 'AUDITING', label: '审核中', color: 'bg-indigo-500/20 text-indigo-400' },
    { value: 'COMPLETED', label: '已完成', color: 'bg-green-500/20 text-green-500' },
];

const ServerTicketsTab: React.FC<ServerTicketsTabProps> = ({
    isAdmin: _isAdmin,
    mqTarget,
    onMqTargetHandled
}) => {
    const [tickets, setTickets] = useState<ServerTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);

    // 查询参数
    const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(0);
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

    const loadTickets = useCallback(async (reset = true, targetPage?: number) => {
        if (!reset && isFetchingRef.current) return;

        const currentRequestId = ++requestIdRef.current;
        isFetchingRef.current = true;

        if (reset) {
            setLoading(true);
        } else {
            setLoadingMore(true);
        }
        setError(null);

        try {
            const fetchPage = reset ? 0 : (targetPage ?? page);
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
                // 默认选中第一个
                if (result.content.length > 0 && !selectedId) {
                    setSelectedId(result.content[0].id);
                }
            } else {
                setTickets(prev => [...prev, ...result.content]);
            }

            setHasMore(result.number + 1 < result.totalPages);
            if (reset) {
                setPage(0);
            } else {
                setPage(fetchPage);
            }
        } catch (err) {
            if (currentRequestId === requestIdRef.current) {
                setError(err instanceof Error ? err.message : '加载失败');
            }
        } finally {
            if (currentRequestId === requestIdRef.current) {
                isFetchingRef.current = false;
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [page, statusFilter, searchQuery, selectedId]);

    // 详情页引用
    const detailRef = useRef<any>(null);

    // 核心数据加载
    useEffect(() => {
        loadTickets(true);
    }, [statusFilter, searchQuery, loadTickets]);

    // MQ 事件处理: 响应来自父组件的调度信号
    // MQ 事件处理: 响应来自父组件的调度信号
    useEffect(() => {
        if (mqTarget) {
            const { id } = mqTarget;
            // 仅仅选中，执行交给详情页或其所在的 Workspace
            setSelectedId(id);
            // 立即标记已处理，防止在这里轮询干扰 Workspace 的轮询
            onMqTargetHandled?.();
        }
    }, [mqTarget, onMqTargetHandled]);

    const refreshSelectedTicket = useCallback(async () => {
        if (selectedId) {
            try {
                const ticket = await ticketApi.getTicketById(selectedId);
                setSelectedTicket(ticket);
            } catch (err) {
                console.error('Failed to refresh details:', err);
            }
        }
    }, [selectedId]);

    // 详情加载与自动滚动
    useEffect(() => {
        if (selectedId) {
            refreshSelectedTicket();

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
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 50) {
            loadTickets(false, page + 1);
        }
    }, [loadTickets, page, hasMore]);

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧列表 */}
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                {/* 头部对齐 MQ 风格 */}
                <div className="p-4 border-b border-white/10 bg-gradient-to-br from-indigo-900/40 to-slate-900/20">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                            <span className="w-1 h-3 bg-indigo-500 rounded-full"></span>
                            Server Tickets
                        </h3>
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-indigo-500/20 text-indigo-400 border border-indigo-500/30`}>
                            Active
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
                            <button
                                onClick={() => setDisplayLang('original')}
                                className={`flex-1 py-1 text-[10px] font-bold rounded-md transition-all ${displayLang === 'original' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                原文
                            </button>
                            <button
                                onClick={() => setDisplayLang('cn')}
                                className={`flex-1 py-1 text-[10px] font-bold rounded-md transition-all ${displayLang === 'cn' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                中文
                            </button>
                        </div>

                        <div className="relative group">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="搜索工单..."
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
                        {STATUS_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setStatusFilter(opt.value)}
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
                    {tickets.map(t => (
                        <button
                            key={t.id}
                            id={`ticket-item-${t.id}`}
                            onClick={() => setSelectedId(t.id)}
                            className={`w-full text-left p-2.5 rounded-lg transition-all border group ${selectedId === t.id
                                ? 'bg-indigo-500/10 border-indigo-500/30 shadow-lg shadow-indigo-500/5'
                                : 'bg-white/5 border-transparent hover:bg-white/10'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-bold text-indigo-400/60 group-hover:text-indigo-400 transition-opacity">#{t.externalId}</span>
                                <span className={`px-1.5 py-0.5 rounded-[4px] text-[8px] font-black uppercase tracking-tighter ${STATUS_OPTIONS.find(o => o.value === t.status)?.color
                                    }`}>
                                    {STATUS_OPTIONS.find(o => o.value === t.status)?.label || t.status}
                                </span>
                            </div>
                            <div className="text-[11px] text-slate-300 truncate font-medium group-hover:text-white transition-colors">
                                {(displayLang === 'cn' && t.translation) ? t.translation.translatedTitle : t.subject}
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
                        <div className="text-center py-12 text-slate-600 text-[10px] italic">暂无工单数据</div>
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
                        displayLang={displayLang}
                        setDisplayLang={setDisplayLang}
                        isSplitMode={isSplitMode}
                        setIsSplitMode={setIsSplitMode}
                        onRefresh={() => {
                            loadTickets(true);
                            refreshSelectedTicket();
                        }}
                    />
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600">
                        <div className="text-sm font-medium">请选择工单查看详情</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ServerTicketsTab;
