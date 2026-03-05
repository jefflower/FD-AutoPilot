import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ticketApi, adminApi } from '../../../shared/services/serverApi';
import ServerTicketDetail from '../components/ServerTicketDetail';
import TicketList from '../../../shared/components/TicketList';
import type { TitleMode } from '../../../shared/components/TicketList';
import type { ServerTicket, TicketQueryParams } from '../../../shared/types/server';
import { getTicketStatusOptions, getFdStatusOptions } from '../../../shared/utils/statusLabels';
import { useAuthContext } from '../../../shared/context/AuthContext';
import DetailEmptyState from '../components/DetailEmptyState';

const ServerTicketsTab: React.FC = () => {
    const { isAdmin } = useAuthContext();
    const { t } = useTranslation(['tickets', 'common', 'settings']);
    const statusOptions = useMemo(() => getTicketStatusOptions(t), [t]);
    const fdStatusOptions = useMemo(() => getFdStatusOptions(), []);

    const [tickets, setTickets] = useState<ServerTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);

    // 查询参数
    const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());  // 空集=全部
    const [fdStatusFilter, setFdStatusFilter] = useState<Set<number>>(new Set([2])); // 默认 Open
    const [searchQuery, setSearchQuery] = useState('');
    const [hasMore, setHasMore] = useState(true);

    // 多选切换
    const toggleStatus = useCallback((value: string) => {
        setStatusFilter(prev => {
            if (value === '') return new Set(); // "全部" 清空选择
            const next = new Set(prev);
            if (next.has(value)) next.delete(value); else next.add(value);
            return next;
        });
    }, []);
    const toggleFdStatus = useCallback((value: number) => {
        setFdStatusFilter(prev => {
            if (value === 0) return new Set(); // "全部FD" 清空选择
            const next = new Set(prev);
            if (next.has(value)) next.delete(value); else next.add(value);
            return next;
        });
    }, []);

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

    // 管理员操作状态
    const [showAdminPanel, setShowAdminPanel] = useState(false);
    const [showPurgeDialog, setShowPurgeDialog] = useState(false);
    const [purgePassword, setPurgePassword] = useState('');
    const [purgeLoading, setPurgeLoading] = useState(false);
    const [purgeResult, setPurgeResult] = useState<{ purgedMessages: number; resetTickets: number } | null>(null);
    const [showPurgeAllDialog, setShowPurgeAllDialog] = useState(false);
    const [purgeAllPassword, setPurgeAllPassword] = useState('');
    const [purgeAllLoading, setPurgeAllLoading] = useState(false);
    const [purgeAllResult, setPurgeAllResult] = useState<{ deletedTickets: number } | null>(null);
    const [toasts, setToasts] = useState<string[]>([]);

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
            if (statusFilter.size > 0) params.status = [...statusFilter].join(',');
            if (fdStatusFilter.size > 0) params.fdStatus = [...fdStatusFilter].join(',');
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
    }, [statusFilter, fdStatusFilter, searchQuery, t]);

    // 核心数据加载
    useEffect(() => {
        loadTickets(true);
    }, [statusFilter, fdStatusFilter, searchQuery, loadTickets]);

    // MQ 事件处理: 响应来自父组件的调度信号


    // 详情加载与自动滚动
    useEffect(() => {
        if (selectedId) {
            ticketApi.getTicketById(selectedId)
                .then(setSelectedTicket)
                .catch(err => console.error('Failed to load details:', err));

            // 自动滚动到选中项
            setTimeout(() => {
                const element = document.querySelector(`[data-ticket-id="${selectedId}"]`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 100);
        } else {
            setSelectedTicket(null);
        }
    }, [selectedId]);

    // 无限滚动 loadMore
    const handleLoadMore = useCallback(() => {
        if (!isFetchingRef.current) {
            loadTickets(false);
        }
    }, [loadTickets]);

    // displayLang → titleMode 映射
    const titleMode: TitleMode = displayLang === 'original' ? 'original' : 'translated';

    // Toast 自动消失
    useEffect(() => {
        if (toasts.length === 0) return;
        const timer = setTimeout(() => setToasts(prev => prev.slice(1)), 4000);
        return () => clearTimeout(timer);
    }, [toasts]);

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
                        <div className="flex items-center gap-2">
                            {isAdmin && (
                                <button
                                    onClick={() => setShowAdminPanel(!showAdminPanel)}
                                    className={`p-1 rounded-md transition-all ${showAdminPanel ? 'bg-red-500/20 text-red-400' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
                                    title={t('tickets:admin.title')}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                </button>
                            )}
                            <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-indigo-500/20 text-indigo-400 border border-indigo-500/30`}>
                                {t('list.active')}
                            </div>
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

                {/* 管理员操作面板 */}
                {isAdmin && showAdminPanel && (
                    <div className="p-3 border-b border-red-500/20 bg-red-500/5 space-y-2">
                        <div className="text-[10px] font-black text-red-400 uppercase tracking-[0.15em]">{t('tickets:admin.title')}</div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setShowPurgeDialog(true); setPurgePassword(''); setPurgeResult(null); }}
                                className="flex-1 px-3 py-1.5 bg-red-600/30 hover:bg-red-600/50 text-red-300 text-[10px] font-bold rounded-lg transition-all border border-red-500/20"
                            >
                                {t('tickets:admin.resetQueues')}
                            </button>
                            <button
                                onClick={() => { setShowPurgeAllDialog(true); setPurgeAllPassword(''); setPurgeAllResult(null); }}
                                className="flex-1 px-3 py-1.5 bg-red-600/30 hover:bg-red-600/50 text-red-300 text-[10px] font-bold rounded-lg transition-all border border-red-500/20"
                            >
                                {t('tickets:admin.purgeAll')}
                            </button>
                        </div>
                    </div>
                )}

                {/* 状态筛选 - 多选胶囊 */}
                <div className="p-2 border-b border-white/10 bg-slate-900/40 space-y-1.5">
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 custom-scrollbar-hidden no-scrollbar">
                        {statusOptions.map(opt => {
                            const isAll = opt.value === '';
                            const active = isAll ? statusFilter.size === 0 : statusFilter.has(opt.value);
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => toggleStatus(opt.value)}
                                    className={`flex-shrink-0 px-3 py-1 rounded-full text-[10px] font-bold transition-all border ${active
                                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400'
                                        : 'bg-white/5 border-transparent text-slate-500 hover:bg-white/10 hover:text-slate-300'
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                    {/* FD 状态筛选 */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 custom-scrollbar-hidden no-scrollbar">
                        <span className="flex-shrink-0 text-[9px] text-slate-600 font-medium mr-0.5">FD:</span>
                        {fdStatusOptions.map(opt => {
                            const isAll = opt.value === 0;
                            const active = isAll ? fdStatusFilter.size === 0 : fdStatusFilter.has(opt.value);
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => toggleFdStatus(opt.value)}
                                    className={`flex-shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-all border ${active
                                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                                        : 'bg-white/5 border-transparent text-slate-500 hover:bg-white/10 hover:text-slate-300'
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 工单列表 */}
                <TicketList
                    tickets={tickets}
                    selectedId={selectedId}
                    onSelect={(ticket) => setSelectedId(ticket.id)}
                    themeColor="indigo"
                    titleMode={titleMode}
                    pagination={{ mode: 'infinite', hasMore, loadMore: handleLoadMore, loadingMore }}
                    loading={loading}
                    emptyText={t('list.noData')}
                />

                {error && (
                    <div className="m-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400 font-bold">
                        {error}
                    </div>
                )}
            </div>

            {/* 右侧详情 */}
            <div className="flex-1 bg-slate-900/40 relative">
                {selectedTicket ? (
                    <ServerTicketDetail
                        ticket={selectedTicket}
                        isEmbed={true}
                        isSplitMode={isSplitMode}
                        setIsSplitMode={setIsSplitMode}
                        onRefresh={() => loadTickets(true)}
                    />
                ) : (
                    <DetailEmptyState title={t('list.selectTicketHint')} />
                )}
            </div>

            {/* 重置队列确认对话框 */}
            {showPurgeDialog && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                        <h4 className="text-lg font-bold text-white mb-4">{t('tickets:admin.purgeConfirmTitle')}</h4>
                        <div className="space-y-4">
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                                <p className="text-xs text-red-300 leading-relaxed">{t('tickets:admin.purgeWarning')}</p>
                                <ul className="text-xs text-red-300/80 mt-2 space-y-1 list-disc list-inside">
                                    <li>{t('tickets:admin.purgeItem1')}</li>
                                    <li>{t('tickets:admin.purgeItem2')}</li>
                                </ul>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2">{t('tickets:admin.superPassword')}</label>
                                <input
                                    type="password"
                                    value={purgePassword}
                                    onChange={(e) => setPurgePassword(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
                                    placeholder={t('tickets:admin.passwordPlaceholder')}
                                    autoFocus
                                />
                            </div>
                            {purgeResult && (
                                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                                    <p className="text-xs text-green-300">
                                        {t('tickets:admin.purgeSuccess', { messages: purgeResult.purgedMessages, tickets: purgeResult.resetTickets })}
                                    </p>
                                </div>
                            )}
                            <div className="flex gap-3 justify-end pt-2">
                                <button
                                    onClick={() => setShowPurgeDialog(false)}
                                    className="px-5 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 text-xs font-bold rounded-lg transition-all border border-white/10"
                                >
                                    {t('common:button.cancel')}
                                </button>
                                <button
                                    onClick={async () => {
                                        if (!purgePassword) return;
                                        setPurgeLoading(true);
                                        try {
                                            const result = await adminApi.purgeQueues(purgePassword);
                                            setPurgeResult(result);
                                            setToasts(prev => [...prev, t('tickets:admin.purgeSuccess', { messages: result.purgedMessages, tickets: result.resetTickets })]);
                                        } catch (err) {
                                            setToasts(prev => [...prev, t('tickets:admin.purgeFailed', { error: (err as Error).message })]);
                                        } finally {
                                            setPurgeLoading(false);
                                        }
                                    }}
                                    disabled={purgeLoading || !purgePassword}
                                    className="px-5 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all"
                                >
                                    {purgeLoading ? t('common:button.processing') : t('tickets:admin.confirmPurge')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 清除所有工单确认对话框 */}
            {showPurgeAllDialog && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                        <h4 className="text-lg font-bold text-white mb-4">{t('settings:purgeAll.confirmTitle')}</h4>
                        <div className="space-y-4">
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                                <p className="text-xs text-red-300 leading-relaxed">{t('settings:purgeAll.confirmWarning')}</p>
                                <ul className="text-xs text-red-300/80 mt-2 space-y-1 list-disc list-inside">
                                    <li>{t('settings:purgeAll.confirmItems.tickets')}</li>
                                    <li>{t('settings:purgeAll.confirmItems.translations')}</li>
                                    <li>{t('settings:purgeAll.confirmItems.replies')}</li>
                                    <li>{t('settings:purgeAll.confirmItems.audits')}</li>
                                </ul>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2">{t('tickets:admin.superPassword')}</label>
                                <input
                                    type="password"
                                    value={purgeAllPassword}
                                    onChange={(e) => setPurgeAllPassword(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
                                    placeholder={t('tickets:admin.passwordPlaceholder')}
                                    autoFocus
                                />
                            </div>
                            {purgeAllResult && (
                                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                                    <p className="text-xs text-green-300">
                                        {t('settings:purgeAll.success', { count: purgeAllResult.deletedTickets })}
                                    </p>
                                </div>
                            )}
                            <div className="flex gap-3 justify-end pt-2">
                                <button
                                    onClick={() => setShowPurgeAllDialog(false)}
                                    className="px-5 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 text-xs font-bold rounded-lg transition-all border border-white/10"
                                >
                                    {t('common:button.cancel')}
                                </button>
                                <button
                                    onClick={async () => {
                                        if (!purgeAllPassword) return;
                                        setPurgeAllLoading(true);
                                        try {
                                            const result = await adminApi.purgeAllTickets(purgeAllPassword);
                                            setPurgeAllResult(result);
                                            setToasts(prev => [...prev, t('settings:purgeAll.success', { count: result.deletedTickets })]);
                                            loadTickets(true); // 清除后刷新列表
                                        } catch (err) {
                                            setToasts(prev => [...prev, t('settings:purgeAll.failed', { error: (err as Error).message })]);
                                        } finally {
                                            setPurgeAllLoading(false);
                                        }
                                    }}
                                    disabled={purgeAllLoading || !purgeAllPassword}
                                    className="px-5 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all"
                                >
                                    {purgeAllLoading ? t('settings:purgeAll.processing') : t('settings:purgeAll.confirm')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Notifications */}
            {toasts.length > 0 && (
                <div className="fixed bottom-4 right-4 space-y-2 z-50">
                    {toasts.slice(-3).map((msg, i) => (
                        <div key={i} className="bg-slate-900/90 backdrop-blur border border-white/10 rounded-lg px-4 py-2 shadow-2xl animate-fade-in">
                            <span className="text-[11px] text-slate-300 font-medium">{msg}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ServerTicketsTab;
