import React, { useState } from 'react';

interface Reply {
    id: number;
    targetReply: string;
    zhReply: string;
    replyLang: string;
    createdAt: string;
}

interface AuditState {
    replyId: number | null;
    result: 'PASS' | 'REJECT';
    remark: string;
}

interface ReplyHistoryPanelProps {
    replies: Reply[];
    ticketStatus: string;
    submitting: boolean;
    onSubmitAudit: (auditState: AuditState) => void;
}

const ReplyHistoryPanel: React.FC<ReplyHistoryPanelProps> = ({
    replies,
    ticketStatus,
    submitting,
    onSubmitAudit,
}) => {
    const [auditState, setAuditState] = useState<AuditState>({
        replyId: null,
        result: 'PASS',
        remark: ''
    });

    if (!replies || replies.length === 0) return null;

    const handleSubmit = () => {
        if (!auditState.replyId) return;
        onSubmitAudit(auditState);
        setAuditState({ replyId: null, result: 'PASS', remark: '' });
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 pt-6 pb-2">
                <div className="w-1.5 h-3 bg-slate-600 rounded-full"></div>
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">History Logs</h4>
            </div>
            {replies.map(reply => (
                <div key={reply.id} className="p-5 bg-slate-800/40 rounded-xl border border-slate-700/50 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">REPLY #{reply.id}</span>
                        <span className="text-[10px] text-slate-500">{reply.createdAt}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <div className="text-[10px] font-bold text-slate-500">TARGET REPLY ({reply.replyLang})</div>
                            <div className="text-sm text-slate-200 bg-black/20 p-3 rounded-lg border border-white/5">{reply.targetReply}</div>
                        </div>
                        <div className="space-y-2">
                            <div className="text-[10px] font-bold text-slate-500">ZH REPLY</div>
                            <div className="text-sm text-slate-200 bg-black/20 p-3 rounded-lg border border-white/5">{reply.zhReply}</div>
                        </div>
                    </div>

                    {/* 审核区域：仅当工单状态为待审核时显示 */}
                    {ticketStatus === 'PENDING_AUDIT' && (
                        <div className="mt-4 pt-4 border-t border-slate-700/50">
                            {auditState.replyId === reply.id ? (
                                <div className="space-y-4 bg-slate-900/40 p-4 rounded-xl border border-blue-500/20 animate-in fade-in slide-in-from-top-2">
                                    <div className="flex items-center gap-4">
                                        <button
                                            onClick={() => setAuditState(s => ({ ...s, result: 'PASS' }))}
                                            className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${auditState.result === 'PASS' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                                        >
                                            APPROVE (通过)
                                        </button>
                                        <button
                                            onClick={() => setAuditState(s => ({ ...s, result: 'REJECT' }))}
                                            className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${auditState.result === 'REJECT' ? 'bg-rose-600 border-rose-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                                        >
                                            REJECT (驳回)
                                        </button>
                                    </div>
                                    <textarea
                                        value={auditState.remark}
                                        onChange={(e) => setAuditState(s => ({ ...s, remark: e.target.value }))}
                                        placeholder="输入审核意见 (可选)..."
                                        className="w-full bg-black/20 border border-slate-700 rounded-lg p-3 text-sm text-white placeholder:text-slate-600 focus:border-blue-500 outline-none h-20 resize-none transition-colors"
                                    />
                                    <div className="flex justify-end gap-3">
                                        <button
                                            onClick={() => setAuditState({ replyId: null, result: 'PASS', remark: '' })}
                                            className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
                                        >
                                            CANCEL
                                        </button>
                                        <button
                                            onClick={handleSubmit}
                                            disabled={submitting}
                                            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-lg transition-all shadow-lg shadow-blue-500/20"
                                        >
                                            {submitting ? 'SUBMITTING...' : 'CONFIRM AUDIT'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => setAuditState({ replyId: reply.id, result: 'PASS', remark: '' })}
                                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded-lg transition-all shadow-lg shadow-indigo-500/20 flex items-center gap-2"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        AUDIT THIS REPLY
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

export default ReplyHistoryPanel;
