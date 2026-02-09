import React, { useState, useEffect, useCallback } from 'react';
import { serverApi } from '../../services/serverApi';
import ServerTicketDetail from './ServerTicketDetail';
import { useMQAudit } from '../../context/MQAuditContext';
import type { ServerTicket } from '../../types/server';

type AuditMode = 'mq' | 'query';

const AuditTasksTab: React.FC = () => {
    const {
        processingTasks,
        completedHistory,
        isRunning,
        startConsumer,
        stopConsumer,
        logs,
        completeAudit,
    } = useMQAudit();

    const [mode, setMode] = useState<AuditMode>('mq');
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Split 模式持久化（与 ServerTicketsTab / ServerTaskWorkspace 共用同一 localStorage key）
    const [isSplitMode, setIsSplitModeState] = useState<boolean>(() => {
        const saved = localStorage.getItem('server_split_mode');
        return saved !== null ? saved === 'true' : true;
    });
    const setIsSplitMode = (s: boolean) => {
        setIsSplitModeState(s);
        localStorage.setItem('server_split_mode', s.toString());
    };

    // MQ 模式 - 驳回状态
    const [rejectingId, setRejectingId] = useState<number | null>(null);
    const [rejectRemark, setRejectRemark] = useState('');

    // 状态查询模式
    const [queryLoading, setQueryLoading] = useState(false);
    const [queryTickets, setQueryTickets] = useState<ServerTicket[]>([]);
    const [queryStats, setQueryStats] = useState({ pending: 0 });
    const [selectedTicketIds, setSelectedTicketIds] = useState<Set<number>>(new Set());

    // 加载选中工单详情
    useEffect(() => {
        if (selectedId) {
            serverApi.ticket.getTicketById(selectedId)
                .then(setSelectedTicket)
                .catch(err => console.error('Failed to load detail:', err));
        } else {
            setSelectedTicket(null);
        }
    }, [selectedId]);

    // ============ MQ 模式逻辑 ============

    const processingList = Array.from(processingTasks.values());

    // 自动选中第一个处理中的任务（仅 MQ 模式）
    useEffect(() => {
        if (mode === 'mq' && processingList.length > 0 && !selectedId) {
            setSelectedId(processingList[0].ticketId);
        }
    }, [processingList.length, mode]);

    const processingTicketIds = new Set(processingList.map(t => t.ticketId));
    const filteredCompletedHistory = completedHistory.filter(t => !processingTicketIds.has(t.ticketId));

    // MQ 审核通过
    const handleMqPass = useCallback(async (ticketId: number) => {
        setSubmitting(true);
        try {
            const ticket = await serverApi.ticket.getTicketById(ticketId);
            if (!ticket.replies || ticket.replies.length === 0) {
                alert('该工单没有回复内容，无法审核');
                return;
            }
            await serverApi.ticket.submitAudit(ticketId, {
                replyId: ticket.replies[0].id,
                auditResult: 'PASS'
            });
            completeAudit(ticketId, true);
            setSelectedId(null);
        } catch (err) {
            alert('审核提交失败: ' + (err as Error).message);
        } finally {
            setSubmitting(false);
        }
    }, [completeAudit]);

    // MQ 审核驳回
    const handleMqReject = useCallback(async (ticketId: number) => {
        setSubmitting(true);
        try {
            const ticket = await serverApi.ticket.getTicketById(ticketId);
            if (!ticket.replies || ticket.replies.length === 0) {
                alert('该工单没有回复内容，无法审核');
                return;
            }
            await serverApi.ticket.submitAudit(ticketId, {
                replyId: ticket.replies[0].id,
                auditResult: 'REJECT',
                auditRemark: rejectRemark
            });
            completeAudit(ticketId, true);
            setRejectingId(null);
            setRejectRemark('');
            setSelectedId(null);
        } catch (err) {
            alert('驳回失败: ' + (err as Error).message);
        } finally {
            setSubmitting(false);
        }
    }, [completeAudit, rejectRemark]);

    // ============ 状态查询模式逻辑 ============

    const loadQueryTasks = useCallback(async (silent = false) => {
        if (!silent) setQueryLoading(true);
        try {
            const [pendingAudit, auditing] = await Promise.all([
                serverApi.ticket.getTickets({ status: 'PENDING_AUDIT', size: 100 }),
                serverApi.ticket.getTickets({ status: 'AUDITING', size: 100 })
            ]);
            const allProcessing = [...auditing.content, ...pendingAudit.content];
            setQueryTickets(allProcessing);
            setQueryStats({ pending: pendingAudit.totalElements + auditing.totalElements });

            if (selectedId && !allProcessing.some(t => t.id === selectedId)) {
                setSelectedId(null);
                setSelectedTicket(null);
            }
        } catch (err) {
            console.error('Failed to load audit tasks:', err);
        } finally {
            if (!silent) setQueryLoading(false);
        }
    }, [selectedId]);

    // 状态查询模式：初始加载 + 轮询
    useEffect(() => {
        if (mode !== 'query') return;
        loadQueryTasks();
        const interval = setInterval(() => loadQueryTasks(true), 15000);
        return () => clearInterval(interval);
    }, [mode, loadQueryTasks]);

    const toggleSelect = (id: number) => {
        const next = new Set(selectedTicketIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedTicketIds(next);
    };

    const selectAll = () => {
        if (selectedTicketIds.size === queryTickets.length) {
            setSelectedTicketIds(new Set());
        } else {
            setSelectedTicketIds(new Set(queryTickets.map(t => t.id)));
        }
    };

    const handleBatchPass = async () => {
        if (selectedTicketIds.size === 0) return;
        setSubmitting(true);
        try {
            const ids = Array.from(selectedTicketIds);
            for (const id of ids) {
                const ticket = queryTickets.find(t => t.id === id);
                if (ticket && ticket.replies && ticket.replies.length > 0) {
                    await serverApi.ticket.submitAudit(id, {
                        replyId: ticket.replies[0].id,
                        auditResult: 'PASS'
                    });
                }
            }
            setSelectedTicketIds(new Set());
            loadQueryTasks();
        } catch (err) {
            alert('批量处理过程中出现错误');
        } finally {
            setSubmitting(false);
        }
    };

    // ============ 共享 ============

    // 切换模式时清空选中状态
    const handleModeSwitch = (newMode: AuditMode) => {
        if (newMode === mode) return;
        setMode(newMode);
        setSelectedId(null);
        setSelectedTicket(null);
        setRejectingId(null);
        setRejectRemark('');
        setSelectedTicketIds(new Set());
    };

    const handleRefresh = useCallback(() => {
        if (selectedId) {
            serverApi.ticket.getTicketById(selectedId)
                .then(setSelectedTicket)
                .catch(console.error);
        }
        if (mode === 'query') {
            loadQueryTasks(true);
        }
    }, [selectedId, mode, loadQueryTasks]);

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧控制区 + 任务列表 */}
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                {/* 模式切换 */}
                <div className="flex border-b border-white/10">
                    <button
                        onClick={() => handleModeSwitch('mq')}
                        className={`flex-1 py-2.5 text-[11px] font-bold tracking-wide transition-all ${
                            mode === 'mq'
                                ? 'text-pink-400 border-b-2 border-pink-500 bg-pink-500/5'
                                : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent'
                        }`}
                    >
                        MQ 队列
                    </button>
                    <button
                        onClick={() => handleModeSwitch('query')}
                        className={`flex-1 py-2.5 text-[11px] font-bold tracking-wide transition-all ${
                            mode === 'query'
                                ? 'text-pink-400 border-b-2 border-pink-500 bg-pink-500/5'
                                : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent'
                        }`}
                    >
                        状态查询
                    </button>
                </div>

                {mode === 'mq' ? (
                    /* ==================== MQ 队列模式 ==================== */
                    <>
                        {/* 头部控制区 */}
                        <div className="p-4 border-b border-white/10 bg-gradient-to-br from-pink-900/40 to-purple-900/20">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                                    <span className="w-1 h-3 bg-pink-500 rounded-full"></span>
                                    MQ 审核任务
                                </h3>
                                <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${isRunning
                                    ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
                                    : 'bg-slate-800 text-slate-500 border border-white/5'
                                    }`}>
                                    {isRunning ? 'Running' : 'Stopped'}
                                </div>
                            </div>

                            <div className="flex gap-2">
                                {!isRunning ? (
                                    <button
                                        onClick={() => startConsumer()}
                                        className="flex-1 h-9 bg-pink-600 hover:bg-pink-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-pink-900/20 transition-all flex items-center justify-center gap-2"
                                    >
                                        启动审核
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => stopConsumer()}
                                        className="flex-1 h-9 bg-red-500/80 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                                    >
                                        停止审核
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* MQ 任务列表 */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-4">
                            {/* Processing 列表 */}
                            <div>
                                <div className="flex items-center justify-between px-2 mb-2">
                                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                        {processingList.length > 0 && <span className="w-1.5 h-1.5 bg-pink-400 rounded-full animate-ping"></span>}
                                        Auditing
                                    </h4>
                                    <span className="text-[10px] font-mono text-pink-500/50">({processingList.length})</span>
                                </div>

                                <div className="space-y-1">
                                    {processingList.map(task => {
                                        const isRejectMode = rejectingId === task.ticketId;

                                        return (
                                            <div
                                                key={task.ticketId}
                                                className={`w-full text-left p-2.5 rounded-lg transition-all border group relative ${selectedId === task.ticketId
                                                    ? 'bg-pink-500/10 border-pink-500/30 shadow-lg shadow-pink-500/5 z-10'
                                                    : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/5'
                                                    }`}
                                            >
                                                <div
                                                    className="cursor-pointer"
                                                    onClick={() => setSelectedId(task.ticketId)}
                                                >
                                                    <div className="flex items-center justify-between mb-0.5">
                                                        <span className="text-[11px] font-bold font-mono text-pink-400 opacity-80 group-hover:opacity-100 transition-opacity">#{task.externalId}</span>
                                                        <div className="w-1.5 h-1.5 bg-pink-400 rounded-full animate-pulse"></div>
                                                    </div>
                                                    <div className="text-[11px] text-slate-300 truncate font-medium group-hover:text-white transition-colors">{task.subject}</div>
                                                </div>

                                                {/* 驳回意见输入框 */}
                                                {isRejectMode && (
                                                    <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-top-1" onClick={(e) => e.stopPropagation()}>
                                                        <textarea
                                                            value={rejectRemark}
                                                            onChange={(e) => setRejectRemark(e.target.value)}
                                                            placeholder="输入驳回意见..."
                                                            className="w-full bg-black/30 border border-rose-500/30 rounded-lg p-2 text-xs text-white placeholder:text-slate-600 focus:border-rose-500 outline-none h-14 resize-none"
                                                            autoFocus
                                                        />
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                onClick={() => { setRejectingId(null); setRejectRemark(''); }}
                                                                className="px-3 py-1 text-[10px] font-bold text-slate-400 hover:text-white transition-colors"
                                                            >
                                                                取消
                                                            </button>
                                                            <button
                                                                onClick={() => handleMqReject(task.ticketId)}
                                                                disabled={submitting}
                                                                className="px-4 py-1 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold rounded-lg transition-all"
                                                            >
                                                                {submitting ? '...' : '确认驳回'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* 操作按钮 */}
                                                <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        onClick={() => handleMqPass(task.ticketId)}
                                                        disabled={submitting}
                                                        className="px-3 py-1 bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-30 text-white text-[10px] font-bold rounded-lg transition-all flex items-center gap-1"
                                                    >
                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                                                        通过
                                                    </button>
                                                    <button
                                                        onClick={() => { setRejectingId(isRejectMode ? null : task.ticketId); setRejectRemark(''); }}
                                                        disabled={submitting}
                                                        className={`px-3 py-1 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1 ${
                                                            isRejectMode
                                                                ? 'bg-rose-600 text-white'
                                                                : 'bg-rose-600/20 text-rose-400 hover:bg-rose-600/40'
                                                        } disabled:opacity-30`}
                                                    >
                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
                                                        驳回
                                                    </button>
                                                </div>

                                                {selectedId === task.ticketId && (
                                                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-pink-500 rounded-l-lg"></div>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {processingList.length === 0 && (
                                        <div className="text-center py-6 text-slate-600 text-[10px] italic border border-dashed border-white/5 rounded-xl">
                                            {isRunning ? '等待审核任务...' : '启动消费后开始审核'}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Completed History 列表 */}
                            <div>
                                <div className="flex items-center justify-between px-2 mb-2 mt-4">
                                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Completed History</h4>
                                    <span className="text-[10px] font-mono text-green-500/50">({filteredCompletedHistory.length})</span>
                                </div>
                                <div className="space-y-1">
                                    {filteredCompletedHistory.map(task => (
                                        <button
                                            key={`${task.ticketId}-${task.addedAt}`}
                                            onClick={() => setSelectedId(task.ticketId)}
                                            className={`w-full text-left p-2 rounded-lg transition-all border group ${selectedId === task.ticketId
                                                ? 'bg-green-500/10 border-green-500/30'
                                                : 'bg-white/5 border-transparent hover:bg-white/10'
                                                }`}
                                        >
                                            <div className="flex items-center justify-between mb-0.5">
                                                <span className="text-[10px] font-bold text-slate-500 opacity-60 group-hover:opacity-100 transition-opacity">#{task.externalId}</span>
                                                <span className={`text-[9px] font-black uppercase tracking-tighter ${task.status === 'completed' ? 'text-green-500/50' : 'text-red-500/50'}`}>
                                                    {task.status === 'completed' ? 'Done' : 'Failed'}
                                                </span>
                                            </div>
                                            <div className="text-[11px] text-slate-400 truncate group-hover:text-slate-200 transition-colors">{task.subject}</div>
                                        </button>
                                    ))}
                                    {filteredCompletedHistory.length === 0 && (
                                        <div className="text-center py-6 text-slate-600 text-[10px] italic border border-dashed border-white/5 rounded-xl">暂无已完成审核</div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 底部日志 */}
                        {logs.length > 0 && (
                            <div className="h-16 bg-black/40 border-t border-white/10 overflow-y-auto p-2 text-[9px] font-mono text-slate-500">
                                {logs.slice(-3).map((log, i) => (
                                    <div key={i} className="truncate">{log}</div>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    /* ==================== 状态查询模式 ==================== */
                    <>
                        <div className="p-4 border-b border-white/10 bg-gradient-to-br from-pink-900/40 to-purple-900/20">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                                    <span className="w-1 h-3 bg-pink-500 rounded-full"></span>
                                    审核任务 ({queryStats.pending})
                                </h3>
                                <button
                                    onClick={selectAll}
                                    className="text-[10px] font-black text-pink-400 uppercase tracking-widest hover:text-white transition-colors"
                                >
                                    {selectedTicketIds.size === queryTickets.length && queryTickets.length > 0 ? '取消全选' : '全选'}
                                </button>
                            </div>

                            <button
                                onClick={handleBatchPass}
                                disabled={selectedTicketIds.size === 0 || submitting}
                                className="w-full h-9 bg-pink-600 hover:bg-pink-500 disabled:opacity-30 disabled:hover:bg-pink-600 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-pink-900/20 flex items-center justify-center gap-2"
                            >
                                {submitting ? '正在处理...' : `批量通过 (${selectedTicketIds.size})`}
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                            {queryTickets.map(task => (
                                <div
                                    key={task.id}
                                    className={`flex items-center gap-2 p-2 rounded-xl transition-all border group ${selectedId === task.id
                                        ? 'bg-pink-500/10 border-pink-500/30'
                                        : 'bg-white/[0.02] border-transparent hover:bg-white/5'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedTicketIds.has(task.id)}
                                        onChange={() => toggleSelect(task.id)}
                                        className="w-4 h-4 rounded border-white/10 bg-black/40 text-pink-500 focus:ring-offset-0 focus:ring-0 cursor-pointer"
                                    />
                                    <button
                                        onClick={() => setSelectedId(task.id)}
                                        className="flex-1 text-left min-w-0"
                                    >
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-[10px] font-bold text-slate-500 group-hover:text-pink-400 transition-colors">#{task.externalId}</span>
                                            <span className={`text-[8px] font-black uppercase tracking-tighter ${task.status === 'AUDITING' ? 'text-indigo-400' : 'text-pink-400'
                                                }`}>
                                                {task.status === 'AUDITING' ? 'Auditing' : 'New'}
                                            </span>
                                        </div>
                                        <div className="text-[11px] text-slate-300 truncate font-medium group-hover:text-white transition-colors">
                                            {task.subject}
                                        </div>
                                    </button>
                                </div>
                            ))}
                            {queryTickets.length === 0 && !queryLoading && (
                                <div className="text-center py-12 text-slate-600 text-[10px] italic">暂无待审核工单</div>
                            )}
                            {queryLoading && queryTickets.length === 0 && (
                                <div className="text-center py-12 text-slate-600 text-[10px] italic">加载中...</div>
                            )}
                        </div>
                    </>
                )}
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
                            <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <p className="text-sm font-medium">
                            {mode === 'mq' ? '点击工单查看完整详情' : '选择左侧工单进行审核'}
                        </p>
                        <p className="text-xs text-slate-700">
                            {mode === 'mq' ? '可在左侧列表快速审核' : '支持批量通过操作'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AuditTasksTab;
