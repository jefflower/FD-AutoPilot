import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { serverApi } from '../../../shared/services/serverApi';
import ServerTicketDetail from '../components/ServerTicketDetail';
import type { ServerTicket } from '../../../shared/types/server';
import EmptyStateHint from '../components/EmptyStateHint';
import DetailEmptyState from '../components/DetailEmptyState';
import MobilePreviewModal from '../components/MobilePreviewModal';
import NotifyConfigPanel from '../components/NotifyConfigPanel';
import TicketList from '../../../shared/components/TicketList';

type ViewMode = 'list' | 'notify-config';

const AuditCenterTab: React.FC = () => {
    const { t } = useTranslation(['tickets', 'common']);

    const [pendingTickets, setPendingTickets] = useState<ServerTicket[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('list');

    // 移动端预览
    const [previewToken, setPreviewToken] = useState<string | null>(null);

    // Split 模式持久化
    const [isSplitMode, setIsSplitModeState] = useState<boolean>(() => {
        const saved = localStorage.getItem('server_split_mode');
        return saved !== null ? saved === 'true' : true;
    });
    const setIsSplitMode = (s: boolean) => {
        setIsSplitModeState(s);
        localStorage.setItem('server_split_mode', s.toString());
    };

    // 自动刷新定时器
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const loadData = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const pending = await serverApi.ticket.getTickets({ status: 'PENDING_AUDIT', size: 100 });
            setPendingTickets(pending.content);
        } catch (err) {
            console.error('[AuditCenterTab] Failed to load data:', err);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
        pollRef.current = setInterval(() => loadData(true), 15000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [loadData]);

    // 选中工单详情加载
    useEffect(() => {
        if (selectedId) {
            serverApi.ticket.getTicketById(selectedId)
                .then(setSelectedTicket)
                .catch(err => console.error('Failed to load detail:', err));
        } else {
            setSelectedTicket(null);
        }
    }, [selectedId]);

    const handleRefresh = useCallback(() => {
        if (selectedId) {
            serverApi.ticket.getTicketById(selectedId)
                .then(setSelectedTicket)
                .catch(console.error);
        }
        loadData(true);
    }, [selectedId, loadData]);

    // 获取移动端审核 Token
    const handleMobilePreview = async (ticketId: number) => {
        try {
            const resp = await serverApi.ticket.getAuditToken(ticketId);
            setPreviewToken(resp.token);
        } catch (err) {
            alert(t('audit.mobilePreviewFailed', { error: (err as Error).message, defaultValue: `获取审核 Token 失败: ${(err as Error).message}` }));
        }
    };

    // 手动通知（发送钉钉/企微审核通知）
    const [notifying, setNotifying] = useState<number | null>(null);
    const handleNotifyAudit = async (ticketId: number) => {
        setNotifying(ticketId);
        try {
            await serverApi.ticket.notifyAudit(ticketId);
        } catch (err) {
            alert(t('audit.notifyFailed', { error: (err as Error).message, defaultValue: `发送审核通知失败: ${(err as Error).message}` }));
        } finally {
            setNotifying(null);
        }
    };

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧面板 */}
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                {/* 头部 */}
                <div className="p-4 border-b border-white/10 bg-gradient-to-br from-purple-900/40 to-slate-900/20">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                            <span className="w-1 h-3 bg-purple-500 rounded-full"></span>
                            {t('audit.title', { defaultValue: '审核中心' })}
                        </h3>
                        <div className="flex items-center gap-2">
                            {/* 通知配置按钮 */}
                            <button
                                onClick={() => setViewMode(viewMode === 'notify-config' ? 'list' : 'notify-config')}
                                className={`p-1.5 rounded-md transition-all ${viewMode === 'notify-config' ? 'bg-purple-500/20 text-purple-400' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
                                title={t('audit.notifyConfig', { defaultValue: '通知配置' })}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                </svg>
                            </button>
                            {/* 待审核 badge */}
                            <div className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-purple-500/20 text-purple-400 border border-purple-500/30">
                                {pendingTickets.length}
                            </div>
                        </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => loadData()}
                            disabled={loading}
                            className="flex-1 h-8 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 text-[10px] font-bold rounded-lg transition-all border border-purple-500/20 flex items-center justify-center gap-1.5"
                        >
                            <svg className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {t('common:button.refresh')}
                        </button>
                    </div>
                </div>

                {/* 工单列表 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-4">
                    {/* 待审核列表 */}
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                {pendingTickets.length > 0 && <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-ping"></span>}
                                {t('audit.pendingSection', { defaultValue: '待审核' })}
                            </h4>
                            <span className="text-[10px] font-mono text-purple-500/50">({pendingTickets.length})</span>
                        </div>

                        {pendingTickets.length === 0 && !loading ? (
                            <EmptyStateHint message={t('audit.noPending', { defaultValue: '暂无待审核工单' })} />
                        ) : (
                            <TicketList
                                tickets={pendingTickets}
                                selectedId={selectedId}
                                onSelect={(ticket) => setSelectedId(selectedId === ticket.id ? null : ticket.id)}
                                themeColor="purple"
                                titleMode="auto"
                                loading={loading}
                                renderActions={(ticket) => (
                                    <>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleMobilePreview(ticket.id); }}
                                            className="px-1.5 py-0.5 text-[9px] font-bold text-blue-400 border border-blue-500/30 rounded transition-all hover:bg-blue-500/10"
                                            title={t('audit.mobilePreview', { defaultValue: '移动端预览' })}
                                        >
                                            {t('audit.mobile', { defaultValue: '移动端' })}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleNotifyAudit(ticket.id); }}
                                            disabled={notifying === ticket.id}
                                            className="px-1.5 py-0.5 text-[9px] font-bold text-amber-400 border border-amber-500/30 rounded transition-all hover:bg-amber-500/10 disabled:opacity-50"
                                            title={t('audit.sendNotify', { defaultValue: '发送审核通知' })}
                                        >
                                            {notifying === ticket.id ? '...' : t('audit.notify', { defaultValue: '通知' })}
                                        </button>
                                    </>
                                )}
                                renderExtra={(ticket) => (
                                    ticket.lastAuditRemark ? (
                                        <span className="text-[9px] text-amber-400/70 truncate block">
                                            {t('audit.lastRemark', { defaultValue: '驳回意见' })}: {ticket.lastAuditRemark}
                                        </span>
                                    ) : null
                                )}
                                renderStatus={(_ticket) => (
                                    <span className="text-[8px] font-black uppercase tracking-tighter text-purple-400/50 flex-shrink-0">
                                        {t('common:ticketStatus.PENDING_AUDIT')}
                                    </span>
                                )}
                            />
                        )}
                    </div>

                </div>
            </div>

            {/* 右侧内容区 */}
            <div className="flex-1 bg-slate-900/40 relative">
                {viewMode === 'notify-config' ? (
                    <NotifyConfigPanel onClose={() => setViewMode('list')} />
                ) : selectedTicket ? (
                    <ServerTicketDetail
                        ticket={selectedTicket}
                        isEmbed={true}
                        isSplitMode={isSplitMode}
                        setIsSplitMode={setIsSplitMode}
                        onRefresh={handleRefresh}
                    />
                ) : (
                    <DetailEmptyState
                        title={t('audit.emptyHint', { defaultValue: '选择一个工单进行审核' })}
                        subtitle={t('audit.emptySubHint', { defaultValue: '从左侧列表选择待审核工单，或等待新工单进入审核队列' })}
                    />
                )}
            </div>

            {/* 移动端预览弹窗 */}
            {previewToken && (
                <MobilePreviewModal
                    token={previewToken}
                    onClose={() => setPreviewToken(null)}
                />
            )}
        </div>
    );
};

export default AuditCenterTab;
