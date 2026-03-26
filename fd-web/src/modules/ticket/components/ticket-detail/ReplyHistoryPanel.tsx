import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauriEnv, tauriInvoke } from '../../../../tauri/bridge';
import { serverApi } from '../../../../shared/services/serverApi';
import { useIsMobile } from '../../../../shared/hooks/useMediaQuery';
import ReplyEditor from './ReplyEditor';

interface Reply {
    id: number;
    targetReply: string;
    zhReply: string;
    replyLang: string;
    createdAt: string;
}

interface AuditState {
    replyId: number | null;
    result: 'PASS' | 'REJECT' | 'SKIP';
    remark: string;
}

interface ReplyHistoryPanelProps {
    replies: Reply[];
    ticketId: number;
    ticketStatus: string;
    submitting: boolean;
    onSubmitAudit: (auditState: AuditState) => void;
    onRefresh?: () => void | Promise<void>;
    hideAuditUI?: boolean; // 移动端底部操作栏接管审核时，隐藏此处审核 UI
}

/**
 * 尝试从可能包含 JSON 的回复文本中提取纯文本内容。
 * 处理旧数据中 targetReply/zhReply 字段存储了完整 JSON 对象的情况。
 */
function extractReplyText(text: string, fieldName: 'targetReply' | 'zhReply'): string {
    if (!text || typeof text !== 'string') return text || '';
    const trimmed = text.trim();
    // 如果不以 { 开头，肯定不是 JSON 对象，直接返回
    if (!trimmed.startsWith('{')) return text;
    try {
        const obj = JSON.parse(trimmed);
        if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
            // 优先提取对应字段名
            const target = obj.targetReply || obj.target_reply || obj.reply || obj.englishReply || '';
            const zh = obj.zhReply || obj.zh_reply || obj.chineseReply || '';
            if (fieldName === 'targetReply' && typeof target === 'string' && target.length > 0) return target;
            if (fieldName === 'zhReply' && typeof zh === 'string' && zh.length > 0) return zh;
        }
    } catch {
        // 不是有效 JSON，原样返回
    }
    return text;
}

const ReplyHistoryPanel: React.FC<ReplyHistoryPanelProps> = ({
    replies,
    ticketId,
    ticketStatus,
    submitting,
    onSubmitAudit,
    onRefresh,
    hideAuditUI = false,
}) => {
    const { t } = useTranslation(['tickets', 'common']);
    const isMobile = useIsMobile();
    const [auditState, setAuditState] = useState<AuditState>({
        replyId: null,
        result: 'PASS',
        remark: ''
    });

    // 编辑模式状态
    const [editingReplyId, setEditingReplyId] = useState<number | null>(null);
    const [editedTarget, setEditedTarget] = useState('');
    const [editedZh, setEditedZh] = useState('');
    const [needsSync, setNeedsSync] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [clearing, setClearing] = useState(false);

    if (!replies || replies.length === 0) return null;

    const handleSubmit = () => {
        if (!auditState.replyId) return;
        onSubmitAudit(auditState);
        setAuditState({ replyId: null, result: 'PASS', remark: '' });
    };

    const enterEditMode = (reply: Reply) => {
        setEditingReplyId(reply.id);
        setEditedTarget(extractReplyText(reply.targetReply, 'targetReply'));
        setEditedZh(extractReplyText(reply.zhReply, 'zhReply'));
        setNeedsSync(false);
        // 退出审核面板
        setAuditState({ replyId: null, result: 'PASS', remark: '' });
    };

    const cancelEdit = () => {
        setEditingReplyId(null);
        setEditedTarget('');
        setEditedZh('');
        setNeedsSync(false);
    };

    const handleSyncTranslation = async (direction: 'zh_to_target' | 'target_to_zh') => {
        if (!isTauriEnv()) {
            alert(t('history.syncNotAvailableInWeb', '翻译同步功能仅在桌面客户端可用'));
            return;
        }
        setSyncing(true);
        try {
            const sourceText = direction === 'zh_to_target' ? editedZh : editedTarget;
            const referenceText = direction === 'zh_to_target' ? editedTarget : editedZh;

            const result = await tauriInvoke<string>('sync_translate_reply_cmd', {
                sourceText,
                referenceText,
                direction,
                targetLang: 'en',
            });

            if (direction === 'zh_to_target') {
                setEditedTarget(result);
            } else {
                setEditedZh(result);
            }
            setNeedsSync(false);
        } catch (e) {
            alert(t('history.syncFailed', { error: (e as Error).message }));
        } finally {
            setSyncing(false);
        }
    };

    const handleClearReplies = async () => {
        if (clearing) return;
        if (!window.confirm(t('history.clearConfirm', '确定要清除所有回复内容吗？清除后工单将回到回复前的状态。'))) return;
        setClearing(true);
        try {
            await serverApi.ticket.clearReplies(ticketId);
            onRefresh?.();
        } catch (e) {
            alert(t('history.clearFailed', { error: (e as Error).message, defaultValue: `清除回复失败: ${(e as Error).message}` }));
        } finally {
            setClearing(false);
        }
    };

    const handleSaveEdit = async () => {
        if (!editingReplyId || saving) return;
        setSaving(true);
        try {
            await serverApi.ticket.updateReply(ticketId, editingReplyId, {
                zhReply: editedZh,
                targetReply: editedTarget,
            });
            setEditingReplyId(null);
            setEditedTarget('');
            setEditedZh('');
            setNeedsSync(false);
            onRefresh?.();
        } catch (e) {
            alert(t('history.saveEditFailed', { error: (e as Error).message }));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 pt-6 pb-2">
                <div className="w-1.5 h-3 bg-slate-600 rounded-full"></div>
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('history.title')}</h4>
            </div>
            {replies.map(reply => {
                const isEditing = editingReplyId === reply.id;

                return (
                    <div key={reply.id} className="p-5 bg-slate-800/40 rounded-xl border border-slate-700/50 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">{t('history.replyLabel', { id: reply.id })}</span>
                                {isEditing && (
                                    <span className="text-[9px] bg-amber-600 text-white px-1.5 py-0.5 rounded-sm font-black uppercase">{t('history.editMode')}</span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-500">{reply.createdAt}</span>
                                {ticketStatus === 'PENDING_AUDIT' && !isEditing && (
                                    <>
                                        <button
                                            onClick={() => enterEditMode(reply)}
                                            className="px-2 py-1 text-[10px] font-bold text-amber-400 border border-amber-500/30 rounded-md hover:bg-amber-500/10 transition-all"
                                        >
                                            {t('history.editReply')}
                                        </button>
                                        <button
                                            onClick={handleClearReplies}
                                            disabled={clearing}
                                            className="px-2 py-1 text-[10px] font-bold text-rose-400 border border-rose-500/30 rounded-md hover:bg-rose-500/10 transition-all disabled:opacity-50"
                                        >
                                            {clearing ? '...' : t('history.clearReply', '清除')}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {isEditing ? (
                            /* 编辑模式：使用共享 ReplyEditor 组件 */
                            <ReplyEditor
                                targetValue={editedTarget}
                                zhValue={editedZh}
                                targetLang={reply.replyLang || 'en'}
                                onTargetChange={(v) => { setEditedTarget(v); setNeedsSync(true); }}
                                onZhChange={(v) => { setEditedZh(v); setNeedsSync(true); }}
                                onTranslate={(direction) => handleSyncTranslation(direction)}
                                translating={syncing}
                                enabledDirections={['zh_to_target', 'target_to_zh']}
                                needsSync={needsSync}
                                primaryAction={{
                                    label: t('history.saveEdit'),
                                    loadingLabel: t('history.savingEdit'),
                                    loading: saving,
                                    disabled: needsSync,
                                    onClick: handleSaveEdit,
                                }}
                                cancelAction={{
                                    label: t('history.cancelEdit'),
                                    onClick: cancelEdit,
                                }}
                                footerHint={needsSync ? t('history.syncBeforeSave') : undefined}
                                themeColor="amber"
                                minTextareaHeight="200px"
                            />
                        ) : (
                            /* 查看模式 */
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <div className="text-[10px] font-bold text-slate-500">{t('history.targetReply')} ({reply.replyLang})</div>
                                        <div className="text-sm text-slate-200 bg-black/20 p-3 rounded-lg border border-white/5 whitespace-pre-wrap">{extractReplyText(reply.targetReply, 'targetReply')}</div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-[10px] font-bold text-slate-500">{t('history.zhReply')}</div>
                                        <div className="text-sm text-slate-200 bg-black/20 p-3 rounded-lg border border-white/5 whitespace-pre-wrap">{extractReplyText(reply.zhReply, 'zhReply')}</div>
                                    </div>
                                </div>

                                {/* 审核区域：仅当工单状态为待审核时显示（移动端底部栏接管时隐藏） */}
                                {ticketStatus === 'PENDING_AUDIT' && !hideAuditUI && (
                                    <div className="mt-4 pt-4 border-t border-slate-700/50">
                                        {auditState.replyId === reply.id ? (
                                            <div className="space-y-4 bg-slate-900/40 p-4 rounded-xl border border-blue-500/20 animate-in fade-in slide-in-from-top-2">
                                                <div className="flex items-center gap-4">
                                                    <button
                                                        onClick={() => setAuditState(s => ({ ...s, result: 'PASS' }))}
                                                        className={`flex-1 ${isMobile ? 'py-3 text-sm' : 'py-2 text-xs'} font-bold rounded-lg border transition-all ${auditState.result === 'PASS' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                                                    >
                                                        {t('history.approve')}
                                                    </button>
                                                    <button
                                                        onClick={() => setAuditState(s => ({ ...s, result: 'REJECT' }))}
                                                        className={`flex-1 ${isMobile ? 'py-3 text-sm' : 'py-2 text-xs'} font-bold rounded-lg border transition-all ${auditState.result === 'REJECT' ? 'bg-rose-600 border-rose-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                                                    >
                                                        {t('history.reject')}
                                                    </button>
                                                    <button
                                                        onClick={() => setAuditState(s => ({ ...s, result: 'SKIP' }))}
                                                        className={`flex-1 ${isMobile ? 'py-3 text-sm' : 'py-2 text-xs'} font-bold rounded-lg border transition-all ${auditState.result === 'SKIP' ? 'bg-slate-600 border-slate-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                                                    >
                                                        {t('history.skip', '无需处理')}
                                                    </button>
                                                </div>
                                                <textarea
                                                    value={auditState.remark}
                                                    onChange={(e) => setAuditState(s => ({ ...s, remark: e.target.value }))}
                                                    placeholder={t('history.auditPlaceholder')}
                                                    className={`w-full bg-black/20 border border-slate-700 rounded-lg p-3 text-sm text-white placeholder:text-slate-600 focus:border-blue-500 outline-none ${isMobile ? 'h-28' : 'h-20'} resize-none transition-colors`}
                                                />
                                                <div className="flex justify-end gap-3">
                                                    <button
                                                        onClick={() => setAuditState({ replyId: null, result: 'PASS', remark: '' })}
                                                        className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
                                                    >
                                                        {t('common:button.cancel')}
                                                    </button>
                                                    <button
                                                        onClick={handleSubmit}
                                                        disabled={submitting}
                                                        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-lg transition-all shadow-lg shadow-blue-500/20"
                                                    >
                                                        {submitting ? t('history.submitting') : t('history.confirmAudit')}
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
                                                    {t('history.auditThisReply')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default ReplyHistoryPanel;
