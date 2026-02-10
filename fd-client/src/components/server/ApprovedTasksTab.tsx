import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { serverApi, configApi } from '../../services/serverApi';
import ServerTicketDetail from './ServerTicketDetail';
import type { ServerTicket } from '../../types/server';

const ApprovedTasksTab: React.FC = () => {
    const { t } = useTranslation(['tasks', 'common']);
    const [loading, setLoading] = useState(false);
    const [pushing, setPushing] = useState<number | null>(null);
    const [batchPushing, setBatchPushing] = useState(false);
    const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
    const [autoReplyLoading, setAutoReplyLoading] = useState(false);

    const [approvedTickets, setApprovedTickets] = useState<ServerTicket[]>([]);
    const [completedTickets, setCompletedTickets] = useState<ServerTicket[]>([]);
    const [selectedTicketIds, setSelectedTicketIds] = useState<Set<number>>(new Set());
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);

    // Split 模式持久化
    const [isSplitMode, setIsSplitModeState] = useState<boolean>(() => {
        const saved = localStorage.getItem('server_split_mode');
        return saved !== null ? saved === 'true' : true;
    });
    const setIsSplitMode = (s: boolean) => {
        setIsSplitModeState(s);
        localStorage.setItem('server_split_mode', s.toString());
    };

    const loadData = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const [approved, completed] = await Promise.all([
                serverApi.ticket.getTickets({ status: 'APPROVED', size: 100 }),
                serverApi.ticket.getTickets({ status: 'COMPLETED', size: 50 })
            ]);
            setApprovedTickets(approved.content);
            setCompletedTickets(completed.content);
        } catch (err) {
            console.error('Failed to load approved tasks:', err);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    const loadAutoReplyConfig = useCallback(async () => {
        try {
            const config = await configApi.getAutoReply();
            setAutoReplyEnabled(config.enabled);
        } catch (err) {
            console.error('Failed to load auto-reply config:', err);
        }
    }, []);

    useEffect(() => {
        loadData();
        loadAutoReplyConfig();
        const interval = setInterval(() => loadData(true), 15000);
        return () => clearInterval(interval);
    }, [loadData, loadAutoReplyConfig]);

    useEffect(() => {
        if (selectedId) {
            serverApi.ticket.getTicketById(selectedId)
                .then(setSelectedTicket)
                .catch(err => console.error('Failed to load detail:', err));
        } else {
            setSelectedTicket(null);
        }
    }, [selectedId]);

    const handleToggleAutoReply = async () => {
        setAutoReplyLoading(true);
        try {
            const newValue = !autoReplyEnabled;
            await configApi.setAutoReply(newValue);
            setAutoReplyEnabled(newValue);
        } catch (err) {
            alert(t('approved.settingFailed', { error: (err as Error).message }));
        } finally {
            setAutoReplyLoading(false);
        }
    };

    const handlePushSingle = async (ticketId: number) => {
        setPushing(ticketId);
        try {
            await serverApi.ticket.pushReply(ticketId);
            loadData(true);
        } catch (err) {
            alert(t('approved.pushFailed', { error: (err as Error).message }));
        } finally {
            setPushing(null);
        }
    };

    const handleBatchPush = async () => {
        if (selectedTicketIds.size === 0) return;
        setBatchPushing(true);
        try {
            const ids = Array.from(selectedTicketIds);
            await serverApi.ticket.batchPushReplies(ids);
            setSelectedTicketIds(new Set());
            loadData(true);
        } catch (err) {
            alert(t('approved.batchPushFailed', { error: (err as Error).message }));
        } finally {
            setBatchPushing(false);
        }
    };

    const toggleSelect = (id: number) => {
        const next = new Set(selectedTicketIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedTicketIds(next);
    };

    const selectAll = () => {
        if (selectedTicketIds.size === approvedTickets.length) {
            setSelectedTicketIds(new Set());
        } else {
            setSelectedTicketIds(new Set(approvedTickets.map(t => t.id)));
        }
    };

    const handleRefresh = useCallback(() => {
        if (selectedId) {
            serverApi.ticket.getTicketById(selectedId)
                .then(setSelectedTicket)
                .catch(console.error);
        }
        loadData(true);
    }, [selectedId, loadData]);

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧控制区 + 任务列表 */}
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                {/* 头部控制区 */}
                <div className="p-4 border-b border-white/10 bg-gradient-to-br from-emerald-900/40 to-teal-900/20">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                            <span className="w-1 h-3 bg-emerald-500 rounded-full"></span>
                            {t('approved.title')}
                        </h3>
                        <button
                            onClick={handleToggleAutoReply}
                            disabled={autoReplyLoading}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                                autoReplyEnabled
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-slate-800 text-slate-500 border border-white/5'
                            }`}
                        >
                            {autoReplyEnabled ? t('approved.autoOn') : t('approved.autoOff')}
                        </button>
                    </div>

                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <button
                                onClick={selectAll}
                                className="h-9 px-3 bg-slate-700/50 hover:bg-slate-700 text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center"
                            >
                                {selectedTicketIds.size === approvedTickets.length && approvedTickets.length > 0 ? t('approved.deselectAll') : t('approved.selectAll')}
                            </button>
                            <button
                                onClick={handleBatchPush}
                                disabled={selectedTicketIds.size === 0 || batchPushing}
                                className="flex-1 h-9 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-900/20 transition-all flex items-center justify-center gap-2"
                            >
                                {batchPushing ? t('approved.batchPushing') : t('approved.batchPush', { count: selectedTicketIds.size })}
                            </button>
                        </div>
                    </div>
                </div>

                {/* 任务列表 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-4">
                    {/* 待推送列表 */}
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                {approvedTickets.length > 0 && <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>}
                                {t('approved.statusApproved')}
                            </h4>
                            <span className="text-[10px] font-mono text-emerald-500/50">({approvedTickets.length})</span>
                        </div>

                        <div className="space-y-1">
                            {approvedTickets.map(ticket => (
                                <div
                                    key={ticket.id}
                                    className={`w-full text-left p-2.5 rounded-lg transition-all border group relative ${
                                        selectedId === ticket.id
                                            ? 'bg-emerald-500/10 border-emerald-500/30 shadow-lg shadow-emerald-500/5 z-10'
                                            : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/5'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={selectedTicketIds.has(ticket.id)}
                                            onChange={() => toggleSelect(ticket.id)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-3.5 h-3.5 rounded border-white/10 bg-black/40 text-emerald-500 focus:ring-0 cursor-pointer flex-shrink-0"
                                        />
                                        <div
                                            className="flex-1 min-w-0 cursor-pointer"
                                            onClick={() => setSelectedId(selectedId === ticket.id ? null : ticket.id)}
                                        >
                                            <div className="flex items-center justify-between mb-0.5">
                                                <span className="text-[11px] font-bold font-mono text-emerald-400 opacity-80 group-hover:opacity-100 transition-opacity">#{ticket.externalId}</span>
                                                <div className="flex items-center gap-1.5">
                                                    {pushing !== ticket.id && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handlePushSingle(ticket.id); }}
                                                            className="px-1.5 py-0.5 bg-emerald-600/60 hover:bg-emerald-500 text-white text-[9px] font-bold rounded transition-all opacity-0 group-hover:opacity-100"
                                                        >
                                                            {t('approved.push')}
                                                        </button>
                                                    )}
                                                    {pushing === ticket.id ? (
                                                        <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
                                                    ) : (
                                                        <span className="text-[8px] font-black text-emerald-400/50 uppercase tracking-tighter">{t('approved.statusApproved')}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-[11px] text-slate-300 truncate font-medium group-hover:text-white transition-colors">{ticket.subject}</div>
                                        </div>
                                    </div>

                                    {selectedId === ticket.id && (
                                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-emerald-500 rounded-l-lg"></div>
                                    )}
                                </div>
                            ))}

                            {approvedTickets.length === 0 && !loading && (
                                <div className="text-center py-6 text-slate-600 text-[10px] italic border border-dashed border-white/5 rounded-xl">
                                    {autoReplyEnabled ? t('approved.autoEnabled') : t('approved.noApproved')}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 已推送列表 */}
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2 mt-4">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">{t('approved.completed')}</h4>
                            <span className="text-[10px] font-mono text-green-500/50">({completedTickets.length})</span>
                        </div>
                        <div className="space-y-1">
                            {completedTickets.map(ticket => (
                                <button
                                    key={ticket.id}
                                    onClick={() => setSelectedId(selectedId === ticket.id ? null : ticket.id)}
                                    className={`w-full text-left p-2 rounded-lg transition-all border group ${
                                        selectedId === ticket.id
                                            ? 'bg-green-500/10 border-green-500/30'
                                            : 'bg-white/5 border-transparent hover:bg-white/10'
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[10px] font-bold text-slate-500 opacity-60 group-hover:opacity-100 transition-opacity">#{ticket.externalId}</span>
                                        <span className="text-[9px] font-black uppercase tracking-tighter text-green-500/50">
                                            {t('approved.statusPushed')}
                                        </span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 truncate group-hover:text-slate-200 transition-colors">{ticket.subject}</div>
                                </button>
                            ))}
                            {completedTickets.length === 0 && (
                                <div className="text-center py-6 text-slate-600 text-[10px] italic border border-dashed border-white/5 rounded-xl">{t('approved.noCompleted')}</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 右侧详情区 */}
            <div className="flex-1 bg-slate-900/40 relative">
                {selectedTicket ? (
                    <ServerTicketDetail
                        ticket={selectedTicket}
                        isEmbed={true}
                        isSplitMode={isSplitMode}
                        setIsSplitMode={setIsSplitMode}
                        onRefresh={handleRefresh}
                    />
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-4">
                        <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center">
                            <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                        </div>
                        <p className="text-sm font-medium">{t('approved.emptyHint')}</p>
                        <p className="text-xs text-slate-700">{t('approved.emptySubHint')}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ApprovedTasksTab;
