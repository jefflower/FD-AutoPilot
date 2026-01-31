import React, { useState, useEffect, useCallback } from 'react';
import { serverApi } from '../../services/serverApi';
import ServerTicketDetail from './ServerTicketDetail';
import type { ServerTicket } from '../../types/server';

interface AuditTasksTabProps {
    mqTarget?: { id: number; type: 'translate' | 'reply' } | null;
    onMqTargetHandled?: () => void;
}

const AuditTasksTab: React.FC<AuditTasksTabProps> = ({
    mqTarget: _mqTarget,
    onMqTargetHandled: _onMqTargetHandled
}) => {
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);

    // 任务状态
    const [processingTickets, setProcessingTickets] = useState<ServerTicket[]>([]);
    const [selectedTicketIds, setSelectedTicketIds] = useState<Set<number>>(new Set());

    // 加载统计信息
    const [stats, setStats] = useState({ pending: 0 });

    // 核心：加载任务列表
    const loadTasks = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const [pendingAudit, auditing] = await Promise.all([
                serverApi.ticket.getTickets({ status: 'PENDING_AUDIT', size: 100 }),
                serverApi.ticket.getTickets({ status: 'AUDITING', size: 100 })
            ]);

            const allProcessing = [...auditing.content, ...pendingAudit.content];
            setProcessingTickets(allProcessing);
            setStats({
                pending: pendingAudit.totalElements + auditing.totalElements
            });

            // 如果当前选中的 ID 不在列表中了，清空选中详情
            if (selectedId && !allProcessing.some(t => t.id === selectedId)) {
                setSelectedId(null);
                setSelectedTicket(null);
            }

            setError(null);
        } catch (err) {
            console.error('Failed to load audit tasks:', err);
            setError('数据刷新失败');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [selectedId]);

    // 初始加载及轮询
    useEffect(() => {
        loadTasks();
        const interval = setInterval(() => loadTasks(true), 15000);
        return () => clearInterval(interval);
    }, [loadTasks]);

    // 监听选中 ID 加载详情
    useEffect(() => {
        if (selectedId) {
            serverApi.ticket.getTicketById(selectedId)
                .then(setSelectedTicket)
                .catch(err => console.error('Failed to load detail:', err));
        } else {
            setSelectedTicket(null);
        }
    }, [selectedId]);

    // 批量选择逻辑
    const toggleSelect = (id: number) => {
        const next = new Set(selectedTicketIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedTicketIds(next);
    };

    const selectAll = () => {
        if (selectedTicketIds.size === processingTickets.length) {
            setSelectedTicketIds(new Set());
        } else {
            setSelectedTicketIds(new Set(processingTickets.map(t => t.id)));
        }
    };

    // 批量操作逻辑
    const handleBatchPass = async () => {
        if (selectedTicketIds.size === 0) return;
        setSubmitting(true);
        try {
            const ids = Array.from(selectedTicketIds);
            // 串行执行或并行执行，根据需求。这里采用串行简单的错误处理内容。
            for (const id of ids) {
                const ticket = processingTickets.find(t => t.id === id);
                if (ticket && ticket.replies && ticket.replies.length > 0) {
                    await serverApi.ticket.submitAudit(id, {
                        replyId: ticket.replies[0].id,
                        auditResult: 'PASS'
                    });
                }
            }
            setSelectedTicketIds(new Set());
            loadTasks();
        } catch (err) {
            alert('批量处理过程中出现错误');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧控制区 */}
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                <div className="p-4 border-b border-white/10 bg-gradient-to-br from-pink-900/40 to-purple-900/20">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                            <span className="w-1 h-3 bg-pink-500 rounded-full"></span>
                            审核任务 ({stats.pending})
                        </h3>
                        <button
                            onClick={selectAll}
                            className="text-[10px] font-black text-pink-400 uppercase tracking-widest hover:text-white transition-colors"
                        >
                            {selectedTicketIds.size === processingTickets.length ? '取消全选' : '全选'}
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
                    {processingTickets.map(task => (
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
                    {processingTickets.length === 0 && !loading && (
                        <div className="text-center py-12 text-slate-600 text-[10px] italic">队列清空了 🎉</div>
                    )}
                </div>
            </div>

            {/* 右侧详情区 */}
            <div className="flex-1 bg-slate-900/40 relative">
                {selectedTicket ? (
                    <ServerTicketDetail
                        ticket={selectedTicket}
                        isEmbed={true}
                        displayLang="cn"
                        onRefresh={() => loadTasks(true)}
                    />
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-4">
                        <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center animate-pulse">
                            <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        </div>
                        <p className="text-sm font-medium">选择左侧工单进行审核</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AuditTasksTab;
