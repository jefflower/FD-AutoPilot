import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ServerTicket, ConversationNote } from '../../../shared/types/server';
import { serverApi } from '../../../shared/services/serverApi';
import { AGENT_MAP } from '../../../shared/constants/agentMap';
import { isTauriEnv } from '../../../tauri/bridge';
import { useIsMobile } from '../../../shared/hooks/useMediaQuery';
import ReplyHistoryPanel from './ticket-detail/ReplyHistoryPanel';
import StatusTimeline from './ticket-detail/StatusTimeline';

/**
 * 清理对话内容中的 AI 预处理标记
 * contentCleaner 为 AI 输入添加的占位符不应显示给用户
 */
function cleanDisplayText(text: string): string {
    if (!text) return '';
    // 移除 [...邮件引用已省略...] 及其前后多余空行
    return text.replace(/\[\.\.\.邮件引用已省略\.\.\.\]\n*/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

interface ServerTicketDetailProps {
    ticket: ServerTicket;
    onRefresh?: () => void | Promise<void>;
    isEmbed?: boolean;
    isSplitMode?: boolean;
    setIsSplitMode?: (s: boolean) => void;
    onBack?: () => void;  // 移动端返回按钮回调
}

interface ParsedContent {
    subject?: string;
    description?: string;
    conversations?: Array<{
        id: number;
        bodyText: string;
        userId: number;
        createdAt: string;
        isPrivate?: boolean;
        incoming?: boolean;
    }>;
}

const ServerTicketDetail: React.FC<ServerTicketDetailProps> = ({
    ticket,
    onRefresh,
    // isEmbed = false,
    isSplitMode: propIsSplitMode,
    setIsSplitMode: propSetIsSplitMode,
    onBack,
}) => {
    const { t } = useTranslation(['tickets', 'common']);
    const isMobile = useIsMobile();
    const [showTranslation, setShowTranslation] = useState(true); // 移动端语言翻转：true=中文翻译（默认）, false=英文原文
    // 移动端审核驳回 UI 状态
    const [mobileRejectExpanded, setMobileRejectExpanded] = useState(false);
    const [mobileRejectRemark, setMobileRejectRemark] = useState('');

    // 审核提交状态（供 ReplyHistoryPanel 使用）
    const [auditSubmitting, setAuditSubmitting] = useState(false);
    // 重新处理
    const [showReprocessConfirm, setShowReprocessConfirm] = useState(false);
    const [reprocessing, setReprocessing] = useState(false);
    const canReprocess = ticket.status !== 'PENDING_TRANS';

    // 优先使用外部传入的分栏状态
    const [internalIsSplitMode, setInternalIsSplitMode] = useState(false);
    const isSplitMode = propIsSplitMode !== undefined ? propIsSplitMode : internalIsSplitMode;
    const setIsSplitMode = (s: boolean) => {
        if (propSetIsSplitMode) propSetIsSplitMode(s);
        else setInternalIsSplitMode(s);
    };

    const [isJsonMode, setIsJsonMode] = useState(false);

    // ---- 对话标注 ----
    const [conversationNotes, setConversationNotes] = useState<ConversationNote[]>([]);
    const [editingNoteConvId, setEditingNoteConvId] = useState<number | null>(null);
    const [editingNoteText, setEditingNoteText] = useState('');
    const [editingNoteType, setEditingNoteType] = useState('GENERAL');
    const [savingNote, setSavingNote] = useState(false);

    const notesByConvId = React.useMemo(() => {
        const map = new Map<number, ConversationNote>();
        conversationNotes.forEach(n => map.set(n.conversationId, n));
        return map;
    }, [conversationNotes]);

    const loadNotes = useCallback(async () => {
        try {
            const notes = await serverApi.ticket.getConversationNotes(ticket.id);
            setConversationNotes(notes);
        } catch (e) {
            console.error('[ServerTicketDetail] Failed to load notes:', e);
        }
    }, [ticket.id]);

    useEffect(() => { loadNotes(); }, [loadNotes]);

    const handleStartEditNote = (convId: number) => {
        const existing = notesByConvId.get(convId);
        setEditingNoteConvId(convId);
        setEditingNoteText(existing?.noteContent || '');
        setEditingNoteType(existing?.noteType || 'GENERAL');
    };

    const handleSaveNote = async () => {
        if (editingNoteConvId === null || !editingNoteText.trim()) return;
        setSavingNote(true);
        try {
            await serverApi.ticket.upsertConversationNote(ticket.id, editingNoteConvId, editingNoteText.trim(), editingNoteType);
            setEditingNoteConvId(null);
            setEditingNoteText('');
            loadNotes();
        } catch (e) {
            alert('保存标注失败: ' + (e as Error).message);
        } finally {
            setSavingNote(false);
        }
    };

    const handleDeleteNote = async (convId: number) => {
        try {
            await serverApi.ticket.deleteConversationNote(ticket.id, convId);
            loadNotes();
        } catch (e) {
            alert('删除标注失败: ' + (e as Error).message);
        }
    };

    const parseJsonContent = (content: string | undefined): ParsedContent | null => {
        if (!content) return null;
        let raw = content;
        // 防御性处理：剥离 markdown 围栏（```json ... ```）
        const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (fenceMatch) raw = fenceMatch[1];
        try {
            const data = JSON.parse(raw);
            if (data && typeof data === 'object') {
                // 兼容 snake_case 键名（AI 可能返回 description_text / body_text）
                if (!data.description && data.description_text) data.description = data.description_text;
                if (!data.description && data.descriptionText) data.description = data.descriptionText;
                if (data.conversations) {
                    data.conversations = data.conversations.map((c: any) => ({
                        ...c,
                        bodyText: c.bodyText || c.body_text || '',
                    }));
                }
                return data;
            }
        } catch (e) { }
        return null;
    };

    const parsedData = React.useMemo(() => parseJsonContent(ticket.content), [ticket.content]);

    const translationData = React.useMemo(() =>
        parseJsonContent(ticket.translation?.translatedContent),
        [ticket.translation?.translatedContent]
    );

    // 合并后的对话列表：将 Description 作为首条
    const combinedConversations = React.useMemo(() => {
        const conversations = [...(parsedData?.conversations || [])];
        if (parsedData?.description) {
            conversations.unshift({
                id: -1, // 特殊 ID 表示 Description
                bodyText: parsedData.description,
                userId: 0,
                createdAt: ticket.createdAt,
                incoming: true
            });
        }
        return conversations;
    }, [parsedData, ticket.createdAt]);

    // === 状态重置：切换工单时清空局部 UI 状态 ===
    useEffect(() => {
        setAuditSubmitting(false);
        setShowReprocessConfirm(false);
        setReprocessing(false);
        setEditingNoteConvId(null);
        setEditingNoteText('');
    }, [ticket.id]);

    const handleReprocess = async () => {
        setReprocessing(true);
        try {
            await serverApi.ticket.restartWorkflow(ticket.id);
            setShowReprocessConfirm(false);
            onRefresh?.();
        } catch (e) {
            alert(t('detail.reprocessFailed', { error: (e as Error).message }));
        } finally {
            setReprocessing(false);
        }
    };

    const handleSubmitAudit = async (auditData: { replyId: number | null, result: 'PASS' | 'REJECT', remark: string }) => {
        if (!auditData.replyId || auditSubmitting) return;
        setAuditSubmitting(true);
        try {
            await serverApi.ticket.submitAudit(ticket.id, {
                replyId: auditData.replyId,
                auditResult: auditData.result,
                auditRemark: auditData.remark
            });
            onRefresh?.();
        } catch (e) {
            alert(t('detail.auditSubmitFailed', { error: (e as Error).message }));
        } finally {
            setAuditSubmitting(false);
        }
    };

    const renderChatBubble = (msg: any, isIncoming: boolean, isEmerald: boolean = false, isDesc: boolean = false) => {
        const maxWidthClass = isMobile ? "max-w-[95%]" : "max-w-[90%]";
        const bubbleBaseClass = `p-3 rounded-lg shadow-sm transition-all duration-200 break-all overflow-wrap-anywhere min-w-0 ${maxWidthClass}`;
        const incomingClass = isEmerald ? "bg-emerald-900/40 text-emerald-100 border border-emerald-700/50" : "bg-slate-700/60 text-slate-100 border border-slate-600/50";
        const outgoingClass = "bg-blue-600/30 text-blue-50 border border-blue-500/30";

        return (
            <div className={`flex flex-col ${isIncoming ? 'items-start' : 'items-end'} w-full min-w-0`}>
                <div className={`flex items-center gap-2 mb-1 px-1 ${isIncoming ? '' : 'flex-row-reverse'}`}>
                    {isDesc && <span className="text-[10px] bg-indigo-500 text-white px-1 rounded-sm font-bold shadow-sm">{t('detail.descTag')}</span>}
                    {isEmerald && <span className="text-[8px] bg-emerald-600/80 text-white px-1 rounded-sm font-black tracking-tighter uppercase">{t('detail.translationTag')}</span>}
                    <span className={`text-[10px] font-black uppercase tracking-wider ${isIncoming ? 'text-slate-400' : 'text-blue-400'}`}>
                        {isIncoming ? t('detail.customerLabel') : (AGENT_MAP[msg.userId.toString()] || t('detail.agentLabel'))}
                    </span>
                    <span className="text-[10px] text-slate-500">{msg.createdAt}</span>
                </div>
                <div className={`${bubbleBaseClass} ${isIncoming ? incomingClass : outgoingClass} ${isEmerald ? 'ring-1 ring-emerald-500/20' : ''}`}>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">{cleanDisplayText(msg.bodyText)}</div>
                </div>
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col bg-slate-900 overflow-hidden relative">
            {/* Header */}
            {isMobile ? (
                /* === 移动端 Header === */
                <div className="flex-none px-3 py-2 border-b border-slate-700/50 bg-slate-800/40 backdrop-blur-sm z-10">
                    {/* 第一行：返回 | #externalId | 状态 badge | reprocess */}
                    <div className="flex items-center gap-2">
                        {onBack && (
                            <button onClick={onBack} className="p-1 -ml-1 text-slate-400 hover:text-white transition-colors flex-shrink-0">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                            </button>
                        )}
                        <span
                            className="text-xs font-bold text-blue-400 flex-shrink-0 hover:text-blue-300 transition-colors cursor-pointer"
                            onClick={() => {
                                const url = `https://simsonn.freshdesk.com/a/tickets/${ticket.externalId}`;
                                if (isTauriEnv()) {
                                    import('@tauri-apps/plugin-opener').then(m => m.openUrl(url)).catch(() => window.open(url, '_blank'));
                                } else {
                                    window.open(url, '_blank');
                                }
                            }}
                        >
                            #{ticket.externalId}
                        </span>
                        <span className={`text-[9px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded-sm ${
                            ticket.status === 'PENDING_AUDIT' ? 'bg-amber-600/30 text-amber-400' :
                            ticket.status === 'COMPLETED' || ticket.status === 'APPROVED' ? 'bg-emerald-600/30 text-emerald-400' :
                            'bg-slate-600/30 text-slate-400'
                        }`}>
                            {t(`common:ticketStatus.${ticket.status}` as any)}
                        </span>
                        <div className="flex-1" />
                        {canReprocess && (
                            <button
                                onClick={() => setShowReprocessConfirm(true)}
                                className="px-2 py-1 rounded text-[9px] font-bold border bg-amber-600/20 border-amber-500/40 text-amber-400"
                            >
                                {t('detail.reprocessBtn')}
                            </button>
                        )}
                    </div>
                    {/* 第二行：标题（根据语言切换状态显示） */}
                    <h2 className="text-xs font-bold text-white truncate mt-1 leading-snug">
                        {showTranslation
                            ? (translationData?.subject || ticket.translation?.translatedTitle || ticket.translatedTitle || ticket.subject)
                            : (ticket.subject || translationData?.subject || ticket.translation?.translatedTitle || ticket.translatedTitle)
                        }
                    </h2>
                </div>
            ) : (
                /* === 桌面端 Header（保持不变） === */
                <div className="flex-none p-3 border-b border-slate-700/50 flex items-center justify-between bg-slate-800/40 backdrop-blur-sm z-10">
                    <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                        <div className="flex flex-col min-w-0">
                            <h2 className="text-xs font-black text-white truncate max-w-[500px] leading-tight flex items-center gap-2">
                                <span
                                    className="text-blue-400 flex-shrink-0 hover:text-blue-300 hover:underline transition-colors cursor-pointer"
                                    title="在 Freshdesk 中打开"
                                    onClick={() => {
                                        const url = `https://simsonn.freshdesk.com/a/tickets/${ticket.externalId}`;
                                        if (isTauriEnv()) {
                                            import('@tauri-apps/plugin-opener').then(m => m.openUrl(url)).catch(() => window.open(url, '_blank'));
                                        } else {
                                            window.open(url, '_blank');
                                        }
                                    }}
                                >
                                    #{ticket.externalId}
                                </span>
                                <span className="text-[9px] text-slate-500 font-mono flex-shrink-0">ID:{ticket.id}</span>
                                <span className="truncate">
                                    {translationData?.subject || ticket.translation?.translatedTitle || ticket.translatedTitle || ticket.subject}
                                </span>
                            </h2>
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">{t(`common:ticketStatus.${ticket.status}` as any)}</span>
                                {(translationData?.subject || ticket.translation?.translatedTitle || ticket.translatedTitle) && (
                                    <span className="text-[9px] text-slate-600 truncate max-w-[300px]" title={ticket.subject}>{ticket.subject}</span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                        {canReprocess && (
                            <button
                                onClick={() => setShowReprocessConfirm(true)}
                                className="px-3 py-1.5 rounded-md text-[10px] font-black border bg-amber-600/20 border-amber-500/40 text-amber-400 hover:bg-amber-600/30 transition-colors"
                            >
                                {t('detail.reprocessBtn')}
                            </button>
                        )}
                        <button onClick={() => setIsJsonMode(!isJsonMode)} className={`px-3 py-1.5 rounded-md text-[10px] font-black border ${isJsonMode ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-400'}`}>
                            JSON
                        </button>
                        <button onClick={() => setIsSplitMode(!isSplitMode)} className={`px-3 py-1.5 rounded-md text-[10px] font-black border ${isSplitMode ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-400'}`}>
                            {t('detail.splitBtn')}
                        </button>
                    </div>
                </div>
            )}

            {/* 视频链接区（仅 VIDEO_REVIEW 类工单） */}
            {ticket.ticketCategory === 'VIDEO_REVIEW' && ticket.videoUrls && (() => {
                let urls: string[] = [];
                try { urls = JSON.parse(ticket.videoUrls); } catch {}
                return urls.length > 0 ? (
                    <div className="flex-none px-4 py-3 border-b border-slate-700/50 bg-purple-900/10">
                        <div className="flex items-center gap-2 mb-2">
                            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest">
                                客户视频 ({urls.length})
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {urls.map((url, i) => {
                                let hostname = '';
                                try { hostname = new URL(url).hostname; } catch { hostname = url; }
                                return (
                                    <a
                                        key={i}
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 hover:text-purple-200 rounded-lg text-xs font-medium border border-purple-500/20 transition-all group"
                                    >
                                        <svg className="w-3 h-3 text-purple-400 group-hover:text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                        </svg>
                                        视频 {i + 1}
                                        <span className="text-[9px] text-purple-500 truncate max-w-[200px]" title={url}>
                                            {hostname}
                                        </span>
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                ) : null;
            })()}

            {/* Content Area */}
            <div className={`flex-1 overflow-y-auto ${isMobile ? 'p-3 space-y-4' : 'p-4 space-y-6'} custom-scrollbar ${isMobile && ticket.status === 'PENDING_AUDIT' && ticket.replies?.length ? 'pb-36' : isMobile ? 'pb-16' : ''}`}>
                {isJsonMode && !isMobile ? (
                    <pre className="text-[10px] text-emerald-400/80 bg-black/40 p-4 rounded-lg border border-slate-800 font-mono whitespace-pre-wrap break-all">
                        {JSON.stringify(ticket, null, 2)}
                    </pre>
                ) : (
                    <>
                        <div className={`${isMobile ? 'space-y-4' : 'space-y-6'} relative`}>
                            {/* 桌面端分栏分割线 */}
                            {!isMobile && isSplitMode && (
                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-slate-700/50 to-transparent pointer-events-none"></div>
                            )}
                            {combinedConversations.map((msg, idx) => {
                                const isAgent = !!AGENT_MAP[msg.userId.toString()];
                                // Description (-1) 始终在左；如果是客服 ID，则在右；否则按 incoming 字段
                                const isIncoming = (msg.id === -1) ? true : (msg.incoming !== false && !isAgent);
                                const isDesc = msg.id === -1;

                                // 翻译匹配逻辑
                                let transMsg = null;
                                if (isDesc) {
                                    if (translationData?.description) transMsg = { bodyText: translationData.description };
                                } else {
                                    transMsg = translationData?.conversations?.find(c => c.id === msg.id);
                                }

                                const existingNote = msg.id > 0 ? notesByConvId.get(msg.id) : null;
                                const isEditingThis = editingNoteConvId === msg.id;

                                // === 移动端语言翻转模式 ===
                                if (isMobile) {
                                    return (
                                        <div key={idx} className="w-full group/conv">
                                            <div className="grid grid-cols-1 gap-2 w-full items-start">
                                                <div className="min-w-0 w-full flex flex-col gap-1.5">
                                                    {/* 移动端：根据 showTranslation 决定显示原文还是翻译 */}
                                                    {showTranslation ? (
                                                        transMsg ? (
                                                            renderChatBubble({ ...transMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc)
                                                        ) : (
                                                            /* 翻译模式下但该条消息无翻译，显示原文并标注"暂无翻译" */
                                                            <>
                                                                {renderChatBubble(msg, isIncoming, false, isDesc)}
                                                                <span className={`text-[9px] text-slate-500 italic px-1 ${isIncoming ? '' : 'self-end'}`}>暂无翻译</span>
                                                            </>
                                                        )
                                                    ) : (
                                                        renderChatBubble(msg, isIncoming, false, isDesc)
                                                    )}

                                                    {/* 移动端标注区域：只显示已有标注，隐藏"添加标注"按钮 */}
                                                    {msg.id > 0 && existingNote && !isEditingThis && (
                                                        <div className={`${isIncoming ? 'pl-1' : 'pr-1'} max-w-[95%] ${isIncoming ? '' : 'self-end'}`}>
                                                            <div className="px-2 py-1 bg-amber-900/25 border border-amber-500/25 rounded-md">
                                                                <div className="flex items-center gap-1 mb-0.5">
                                                                    <span className="text-[8px] font-black uppercase tracking-wider text-amber-500/70">
                                                                        {existingNote.noteType === 'VIDEO_REVIEW' ? '视频审查' : '标注'}
                                                                    </span>
                                                                </div>
                                                                <p className="text-[11px] text-amber-200/80 leading-relaxed whitespace-pre-wrap">{existingNote.noteContent}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // === 桌面端：保持原有逻辑不变 ===
                                return (
                                    <div key={idx} className="w-full group/conv">
                                        <div className={`grid ${isSplitMode ? 'grid-cols-2 gap-16' : 'grid-cols-1 gap-3'} w-full items-start`}>
                                            <div className="min-w-0 w-full flex flex-col gap-2">
                                                {/* 原文气泡 */}
                                                {renderChatBubble(msg, isIncoming, false, isDesc)}

                                                {/* 标注区域（仅非 Description 对话） */}
                                                {msg.id > 0 && (
                                                    <div className={`${isIncoming ? 'pl-1' : 'pr-1'} max-w-[90%] ${isIncoming ? '' : 'self-end'}`}>
                                                        {/* 已有标注显示 */}
                                                        {existingNote && !isEditingThis && (
                                                            <div className="flex items-start gap-1.5 group mt-0.5">
                                                                <div className="flex-1 px-2.5 py-1.5 bg-amber-900/25 border border-amber-500/25 rounded-md">
                                                                    <div className="flex items-center gap-1.5 mb-0.5">
                                                                        <span className="text-[8px] font-black uppercase tracking-wider text-amber-500/70">
                                                                            {existingNote.noteType === 'VIDEO_REVIEW' ? '视频审查' : '标注'}
                                                                        </span>
                                                                        <span className="text-[8px] text-slate-600">{existingNote.createdBy}</span>
                                                                    </div>
                                                                    <p className="text-[11px] text-amber-200/80 leading-relaxed whitespace-pre-wrap">{existingNote.noteContent}</p>
                                                                </div>
                                                                <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <button onClick={() => handleStartEditNote(msg.id)} className="p-0.5 text-slate-500 hover:text-amber-400 transition-colors" title="编辑标注">
                                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                                    </button>
                                                                    <button onClick={() => handleDeleteNote(msg.id)} className="p-0.5 text-slate-500 hover:text-red-400 transition-colors" title="删除标注">
                                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {/* 添加标注按钮 */}
                                                        {!existingNote && !isEditingThis && (
                                                            <button
                                                                onClick={() => handleStartEditNote(msg.id)}
                                                                className="mt-0.5 px-2 py-0.5 text-[9px] text-slate-600 hover:text-amber-400 hover:bg-amber-900/20 rounded transition-all flex items-center gap-1 opacity-0 group-hover/conv:opacity-100"
                                                            >
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                                                                添加标注
                                                            </button>
                                                        )}
                                                        {/* 内联编辑器 */}
                                                        {isEditingThis && (
                                                            <div className="mt-1 p-2.5 bg-slate-800/60 border border-amber-500/30 rounded-lg space-y-2">
                                                                <div className="flex items-center gap-2">
                                                                    <select
                                                                        value={editingNoteType}
                                                                        onChange={e => setEditingNoteType(e.target.value)}
                                                                        className="bg-black/30 border border-slate-600 rounded px-2 py-0.5 text-[10px] text-slate-300 outline-none"
                                                                    >
                                                                        <option value="GENERAL">通用标注</option>
                                                                        <option value="VIDEO_REVIEW">视频审查结论</option>
                                                                        <option value="CORRECTION">纠正说明</option>
                                                                    </select>
                                                                    <span className="text-[9px] text-slate-600 ml-auto">#{msg.id}</span>
                                                                </div>
                                                                <textarea
                                                                    value={editingNoteText}
                                                                    onChange={e => setEditingNoteText(e.target.value)}
                                                                    placeholder="输入标注内容（如视频审查结论、补充说明等）..."
                                                                    className="w-full bg-black/30 border border-slate-600 rounded-lg p-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-amber-500 outline-none resize-y"
                                                                    style={{ minHeight: '60px' }}
                                                                    autoFocus
                                                                />
                                                                <div className="flex justify-end gap-2">
                                                                    <button onClick={() => { setEditingNoteConvId(null); setEditingNoteText(''); }} className="px-3 py-1 text-[10px] text-slate-400 hover:text-white transition-colors">
                                                                        取消
                                                                    </button>
                                                                    <button
                                                                        onClick={handleSaveNote}
                                                                        disabled={savingNote || !editingNoteText.trim()}
                                                                        className="px-3 py-1 text-[10px] font-bold bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded transition-all"
                                                                    >
                                                                        {savingNote ? '保存中...' : '保存标注'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* 非分栏模式下，紧跟展示翻译气泡 */}
                                                {!isSplitMode && transMsg && (
                                                    <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-300">
                                                        {renderChatBubble({ ...transMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc)}
                                                    </div>
                                                )}
                                            </div>

                                            {isSplitMode && (
                                                <div className="min-w-0 w-full flex flex-col gap-2">
                                                    {transMsg ? (
                                                        renderChatBubble({ ...transMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc)
                                                    ) : (
                                                        <div className="h-full flex items-center justify-center border border-dashed border-slate-700 rounded-lg py-6 text-slate-600 text-[10px] italic">
                                                            {t('detail.noTranslation')}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* 回复历史区块：有历史回复时始终显示 */}
                        {ticket.replies && ticket.replies.length > 0 && (
                            <div className="pt-6 border-t border-slate-800/80">
                                <ReplyHistoryPanel
                                    replies={ticket.replies}
                                    ticketId={ticket.id}
                                    ticketStatus={ticket.status}
                                    submitting={auditSubmitting}
                                    onSubmitAudit={handleSubmitAudit}
                                    onRefresh={onRefresh}
                                    hideAuditUI={isMobile && ticket.status === 'PENDING_AUDIT'}
                                />
                            </div>
                        )}

                        {/* 状态时间线 */}
                        <div className="pt-6 border-t border-slate-800/80">
                            <StatusTimeline ticketId={ticket.id} />
                        </div>
                    </>
                )}
            </div>

            {/* 移动端悬浮语言切换按钮 */}
            {isMobile && translationData && (
                <button
                    onClick={(e) => { e.stopPropagation(); setShowTranslation(prev => !prev); }}
                    className={`fixed right-4 w-12 h-12 rounded-full bg-indigo-600 text-white shadow-lg z-[60] flex items-center justify-center text-sm font-bold active:scale-95 transition-transform ${
                      ticket.status === 'PENDING_AUDIT' && ticket.replies && ticket.replies.length > 0 ? 'bottom-36' : 'bottom-24'
                    }`}
                    style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
                >
                    {showTranslation ? 'EN' : '中'}
                </button>
            )}

            {/* 移动端底部审核操作栏 */}
            {isMobile && ticket.status === 'PENDING_AUDIT' && ticket.replies && ticket.replies.length > 0 && (() => {
                const latestReplyId = ticket.replies[ticket.replies.length - 1].id;
                return (
                    <div className="fixed bottom-14 left-0 right-0 bg-slate-900/95 backdrop-blur-sm border-t border-slate-700/50 z-30">
                        {mobileRejectExpanded ? (
                            /* 驳回原因输入 */
                            <div className="p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-red-400">驳回原因</span>
                                    <button
                                        onClick={() => { setMobileRejectExpanded(false); setMobileRejectRemark(''); }}
                                        className="text-xs text-slate-500"
                                    >
                                        取消
                                    </button>
                                </div>
                                <textarea
                                    value={mobileRejectRemark}
                                    onChange={e => setMobileRejectRemark(e.target.value)}
                                    placeholder="请输入驳回原因..."
                                    className="w-full bg-black/30 border border-slate-600 rounded-lg p-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-red-500 outline-none resize-none"
                                    style={{ minHeight: '60px' }}
                                    autoFocus
                                />
                                <button
                                    onClick={() => {
                                        handleSubmitAudit({ replyId: latestReplyId, result: 'REJECT', remark: mobileRejectRemark });
                                        setMobileRejectExpanded(false);
                                        setMobileRejectRemark('');
                                    }}
                                    disabled={auditSubmitting || !mobileRejectRemark.trim()}
                                    className="w-full h-11 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-all"
                                >
                                    {auditSubmitting ? '提交中...' : '确认驳回'}
                                </button>
                            </div>
                        ) : (
                            /* 通过 / 驳回 按钮组 */
                            <div className="flex gap-3 p-3">
                                <button
                                    onClick={() => handleSubmitAudit({ replyId: latestReplyId, result: 'PASS', remark: '' })}
                                    disabled={auditSubmitting}
                                    className="flex-[3] h-12 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-base font-bold rounded-lg transition-all flex items-center justify-center gap-1.5"
                                >
                                    {auditSubmitting ? '提交中...' : '通过'}
                                </button>
                                <button
                                    onClick={() => setMobileRejectExpanded(true)}
                                    disabled={auditSubmitting}
                                    className="flex-[2] h-12 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-white text-base font-bold rounded-lg transition-all flex items-center justify-center gap-1.5"
                                >
                                    驳回
                                </button>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* 重新处理确认对话框 */}
            {showReprocessConfirm && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl mx-4">
                        <h4 className="text-sm font-bold text-white mb-3">{t('detail.reprocessConfirmTitle')}</h4>
                        <p className="text-xs text-slate-400 mb-5 leading-relaxed">{t('detail.reprocessConfirmDesc')}</p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowReprocessConfirm(false)}
                                disabled={reprocessing}
                                className="px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 text-xs font-bold rounded-lg transition-all border border-white/10"
                            >
                                {t('common:button.cancel')}
                            </button>
                            <button
                                onClick={handleReprocess}
                                disabled={reprocessing}
                                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all"
                            >
                                {reprocessing ? t('common:button.processing') : t('common:button.confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ServerTicketDetail;
