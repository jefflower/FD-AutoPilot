import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { serverApi, configApi } from '../../../shared/services/serverApi';
import ServerTicketDetail from '../components/ServerTicketDetail';
import type { ServerTicket } from '../../../shared/types/server';
import TaskStatusBadge from '../components/TaskStatusBadge';
import CompletedTaskCard from '../components/CompletedTaskCard';
import EmptyStateHint from '../components/EmptyStateHint';
import DetailEmptyState from '../components/DetailEmptyState';
import TicketList from '../../../shared/components/TicketList';

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
                        <TaskStatusBadge
                            isActive={autoReplyEnabled}
                            activeLabel={t('approved.autoOn')}
                            inactiveLabel={t('approved.autoOff')}
                            color="emerald"
                            onClick={handleToggleAutoReply}
                            disabled={autoReplyLoading}
                        />
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

                        <TicketList
                            tickets={approvedTickets}
                            selectedId={selectedId}
                            onSelect={(ticket) => setSelectedId(selectedId === ticket.id ? null : ticket.id)}
                            themeColor="emerald"
                            titleMode="original"
                            selectable
                            selectedIds={selectedTicketIds}
                            onSelectionChange={setSelectedTicketIds}
                            renderActions={(ticket) => (
                                <>
                                    {pushing !== ticket.id && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handlePushSingle(ticket.id); }}
                                            className="px-1.5 py-0.5 bg-emerald-600/60 hover:bg-emerald-500 text-white text-[9px] font-bold rounded transition-all"
                                        >
                                            {t('approved.push')}
                                        </button>
                                    )}
                                    {pushing === ticket.id && (
                                        <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
                                    )}
                                </>
                            )}
                            renderStatus={(ticket) => (
                                pushing === ticket.id
                                    ? <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
                                    : <span className="text-[8px] font-black text-emerald-400/50 uppercase tracking-tighter">{t('approved.statusApproved')}</span>
                            )}
                            loading={loading}
                            emptyText={autoReplyEnabled ? t('approved.autoEnabled') : t('approved.noApproved')}
                        />
                    </div>

                    {/* 已推送列表 */}
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2 mt-4">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">{t('approved.completed')}</h4>
                            <span className="text-[10px] font-mono text-green-500/50">({completedTickets.length})</span>
                        </div>
                        <div className="space-y-1">
                            {completedTickets.map(ticket => (
                                <CompletedTaskCard
                                    key={ticket.id}
                                    ticketId={ticket.id}
                                    externalId={ticket.externalId}
                                    subject={ticket.subject}
                                    status="completed"
                                    statusLabel={t('approved.statusPushed')}
                                    isSelected={selectedId === ticket.id}
                                    onSelect={(id) => setSelectedId(selectedId === id ? null : id)}
                                />
                            ))}
                            {completedTickets.length === 0 && (
                                <EmptyStateHint message={t('approved.noCompleted')} />
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
                    <DetailEmptyState
                        title={t('approved.emptyHint')}
                        subtitle={t('approved.emptySubHint')}
                    />
                )}
            </div>
        </div>
    );
};

export default ApprovedTasksTab;
