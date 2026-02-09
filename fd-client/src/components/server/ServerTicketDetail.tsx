import React, { useState, useCallback, useEffect } from 'react';
import { ServerTicket } from '../../types/server';
import { serverApi } from '../../services/serverApi';
import { useSettings } from '../../hooks/useSettings';
import { useNotebookShadow } from '../../hooks/useNotebookShadow';
import { useTicketProcess } from '../../hooks/useTicketProcess';
import { useAiReply } from '../../hooks/useAiReply';
import { useAiTranslation } from '../../hooks/useAiTranslation';
import { AGENT_MAP } from '../../constants/agentMap';
import { ask, message } from '@tauri-apps/plugin-dialog';
import TranslationPreviewBar from './ticket-detail/TranslationPreviewBar';
import AiReplyPanel from './ticket-detail/AiReplyPanel';
import ReplyHistoryPanel from './ticket-detail/ReplyHistoryPanel';

interface ServerTicketDetailProps {
    ticket: ServerTicket;
    onRefresh?: () => void | Promise<void>;
    isEmbed?: boolean;
    isProcessing?: boolean;
    isSplitMode?: boolean;
    setIsSplitMode?: (s: boolean) => void;
    activeProcessType?: 'translating' | 'replying' | null;
    onProcessStatusChange?: (ticketId: number, status: 'translating' | 'replying' | null) => void;
}

interface ParsedContent {
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

export interface ServerTicketDetailHandle {
    handleAiTranslate: (autoSave?: boolean) => Promise<boolean>;
    handleTriggerAiReply: (autoSave?: boolean) => Promise<boolean>;
    getTicketId: () => number;
}

const ServerTicketDetail = React.forwardRef<ServerTicketDetailHandle, ServerTicketDetailProps>(({
    ticket,
    onRefresh,
    // isEmbed = false,
    isProcessing = false,
    isSplitMode: propIsSplitMode,
    setIsSplitMode: propSetIsSplitMode,
    activeProcessType,
    onProcessStatusChange
}, ref) => {
    const [submitting, setSubmitting] = useState(false);
    const { notebookLMConfig: notebookConfig } = useSettings();
    const { visible: shadowVisible, toggle: handleToggleShadow } = useNotebookShadow();
    const { runReply } = useAiReply();
    const { runTranslation } = useAiTranslation();
    const [aiReplyText, setAiReplyText] = useState('');
    const [aiReplies, setAiReplies] = useState<[string, string] | null>(null); // [工单语言, 中文]
    const [aiReplyLang, setAiReplyLang] = useState<'original' | 'cn'>('original');
    const [aiError, setAiError] = useState<string | null>(null);
    const [currentPrompt, setCurrentPrompt] = useState<string>(''); // 存储发给 AI 的完整提示词
    const [showPrompts, setShowPrompts] = useState(false); // 是否显示提示词视图
    const aiResponseEndRef = React.useRef<HTMLDivElement>(null);

    // AI 处理状态持久化 (从全局 Hook 获取)
    const { getProcessState, setTempTranslation: setGlobalTempTranslation } = useTicketProcess();
    const processState = getProcessState(ticket.id);

    // 临时保存的AI回复（手动触发时使用，需用户确认后才保存）
    const [tempAiReply, setTempAiReply] = useState<[string, string] | null>(null);

    const isTranslating = activeProcessType === 'translating' || processState.status === 'translating';
    const generatingAiReply = activeProcessType === 'replying' || processState.status === 'replying';

    // MQ 流式文本：当 MQ 任务正在处理且本地 aiReplyText 为空时，使用全局流式文本
    const mqStreamingText = processState.streamingText || '';

    const tempTranslation = processState.tempTranslation;
    const isTranslationDiffMode = !!tempTranslation;

    // 自动滚动 AI 回复到底部
    React.useEffect(() => {
        if (aiReplyText || mqStreamingText) {
            aiResponseEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [aiReplyText, mqStreamingText]);

    // 优先使用外部传入的分栏状态
    const [internalIsSplitMode, setInternalIsSplitMode] = useState(false);
    const isSplitMode = propIsSplitMode !== undefined ? propIsSplitMode : internalIsSplitMode;
    const setIsSplitMode = (s: boolean) => {
        if (propSetIsSplitMode) propSetIsSplitMode(s);
        else setInternalIsSplitMode(s);
    };

    // 审核提交状态（供 ReplyHistoryPanel 使用）
    const [auditSubmitting, setAuditSubmitting] = useState(false);

    const parseJsonContent = (content: string | undefined): ParsedContent | null => {
        if (!content) return null;
        try {
            const data = JSON.parse(content);
            if (data && typeof data === 'object') return data;
        } catch (e) { }
        return null;
    };

    const parsedData = React.useMemo(() => parseJsonContent(ticket.content), [ticket.content]);

    const oldTranslation = React.useMemo(() =>
        parseJsonContent(ticket.translation?.translatedContent),
        [ticket.translation?.translatedContent]
    );

    const newTranslation = React.useMemo(() =>
        isTranslationDiffMode && tempTranslation ? parseJsonContent(tempTranslation.translatedContent) : null,
        [tempTranslation, isTranslationDiffMode]
    );

    // === 状态监控日志 ===
    useEffect(() => {
        if (isTranslating || generatingAiReply) {
            console.log(`[StatusCheck] Animation active. translates:${isTranslating}, reply:${generatingAiReply}, ticket:${ticket.id}`);
        }
    }, [isTranslating, generatingAiReply, ticket.id]);

    // === 状态派生：处理状态完全由父组件 prop 驱动，确保跨组件卸载持久化 ===
    // (已移动到上方 useState 处合并定义)

    // === 状态重置：切换工单时清空局部 UI 状态 ===
    useEffect(() => {
        console.log(`[ServerTicketDetail] Ticket ID changed to #${ticket.id}, activeProcessType from parent: ${activeProcessType}`);
        // 局部 UI 状态重置
        setAiError(null);
        setAiReplies(null);
        setAiReplyText('');
    }, [ticket.id]);

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


    const handleAiTranslate = useCallback(async (autoSave: boolean = false): Promise<boolean> => {
        if (!autoSave && (isTranslating || generatingAiReply || isProcessing)) return false;

        setAiError(null);

        const success = await runTranslation(ticket, {
            autoSave,
            onStatusChange: (status) => onProcessStatusChange?.(ticket.id, status),
            onError: (err) => { setAiError(err); if (!autoSave) alert('翻译失败: ' + err); },
        });

        if (success && autoSave) onRefresh?.();
        return success;
    }, [ticket, runTranslation, isTranslating, generatingAiReply, isProcessing, onRefresh, onProcessStatusChange]);

    const handleConfirmTranslation = async () => {
        if (!tempTranslation || submitting) return;
        setSubmitting(true);
        console.log('[SubmitTranslation] Starting...', { ticketId: ticket.id, data: tempTranslation });
        try {
            await serverApi.ticket.submitTranslation(ticket.id, tempTranslation as any);
            console.log('[SubmitTranslation] Success, updating local state for instant feedback');

            // 1. 手动更新当前 ticket 对象中的翻译（乐观更新），确保视觉上不闪回旧数据
            if (ticket) {
                const newTranslation = {
                    ...(ticket.translation || {}),
                    ...tempTranslation,
                    id: ticket.translation?.id || Date.now(),
                    createdAt: new Date().toISOString()
                };
                // @ts-ignore - 临时修改 prop 引用以实现即时刷新，父组件随后会传回真正的对象
                ticket.translation = newTranslation;
            }

            // 2. 清理临时状态
            setGlobalTempTranslation(ticket.id, null);

            // 3. 通知父组件刷新（背景同步）
            if (onRefresh) {
                onRefresh();
            }
        } catch (e) {
            console.error('[SubmitTranslation] Failed:', e);
            alert('保存翻译失败: ' + (e as Error).message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleTriggerAiReply = useCallback(async (autoSave: boolean = false): Promise<boolean> => {
        if (!autoSave && (generatingAiReply || isTranslating || isProcessing)) return false;

        // 清理 UI 状态
        setAiReplyText('');
        setAiReplies(null);
        setTempAiReply(null);
        setAiError(null);

        const success = await runReply(ticket, {
            autoSave,
            onStatusChange: (status) => onProcessStatusChange?.(ticket.id, status),
            onError: (err) => { setAiError(err); if (!autoSave) alert(err); },
            onStreamChunk: (text) => setAiReplyText(text),
            onParsed: (replies) => {
                setAiReplies(replies);
                if (!autoSave) setTempAiReply(replies);
            },
            onPromptReady: (prompt) => setCurrentPrompt(prompt),
        });

        if (success && autoSave) onRefresh?.();
        return success;
    }, [ticket, runReply, generatingAiReply, isTranslating, isProcessing, onRefresh, onProcessStatusChange]);

    // 确认保存AI回复（手动触发后用户点击保存）
    const handleConfirmReply = async () => {
        if (!tempAiReply || submitting) return;
        setSubmitting(true);
        try {
            await serverApi.ticket.submitReply(ticket.id, {
                zhReply: tempAiReply[1],
                targetReply: tempAiReply[0]
            });
            setTempAiReply(null);
            setAiReplies(null);
            setAiReplyText('');
            onRefresh?.();
        } catch (e) {
            alert('保存回复失败: ' + (e as Error).message);
        } finally {
            setSubmitting(false);
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
            alert('审核提交失败: ' + (e as Error).message);
        } finally {
            setAuditSubmitting(false);
        }
    };

    const [mqSubmitting, setMqSubmitting] = useState(false);

    const handleTriggerMqTranslate = async () => {
        if (mqSubmitting) return;

        const confirmed = await ask('确定要发送 MQ 翻译请求吗？这会重新入队处理。', {
            title: 'MQ 翻译确认',
            kind: 'warning'
        });

        if (!confirmed) return;

        setMqSubmitting(true);
        try {
            await serverApi.ticket.triggerAiTranslation(ticket.id);
            await message('MQ 翻译任务已发送，请在"翻译任务"标签页中查看进度。', { title: '已入队', kind: 'info' });
            onRefresh?.();
        } catch (e) {
            console.error('MQ Translate Error:', e);
            await message('MQ 翻译触发失败: ' + (e as Error).message, { title: '错误', kind: 'error' });
        } finally {
            setMqSubmitting(false);
        }
    };

    const handleTriggerMqReply = async () => {
        if (mqSubmitting) return;

        const confirmed = await ask('确定要发送 MQ 回复生成请求吗？这会重新入队处理。', {
            title: 'MQ 回复确认',
            kind: 'warning'
        });

        if (!confirmed) return;

        setMqSubmitting(true);
        try {
            await serverApi.ticket.triggerAiReply(ticket.id);
            await message('MQ 回复任务已发送，请在"回复任务"标签页中查看进度。', { title: '已入队', kind: 'info' });
            onRefresh?.();
        } catch (e) {
            console.error('MQ Reply Error:', e);
            await message('MQ 回复触发失败: ' + (e as Error).message, { title: '错误', kind: 'error' });
        } finally {
            setMqSubmitting(false);
        }
    };

    const [isJsonMode, setIsJsonMode] = useState(false);

    const renderChatBubble = (msg: any, isIncoming: boolean, isEmerald: boolean = false, isDesc: boolean = false, customTag?: string) => {
        const bubbleBaseClass = "p-3 rounded-lg shadow-sm transition-all duration-200 break-all overflow-wrap-anywhere min-w-0 max-w-[90%]";
        const incomingClass = isEmerald ? "bg-emerald-900/40 text-emerald-100 border border-emerald-700/50" : "bg-slate-700/60 text-slate-100 border border-slate-600/50";
        const outgoingClass = "bg-blue-600/30 text-blue-50 border border-blue-500/30";

        return (
            <div className={`flex flex-col ${isIncoming ? 'items-start' : 'items-end'} w-full min-w-0`}>
                <div className={`flex items-center gap-2 mb-1 px-1 ${isIncoming ? '' : 'flex-row-reverse'}`}>
                    {isDesc && <span className="text-[10px] bg-indigo-500 text-white px-1 rounded-sm font-bold shadow-sm">DESC</span>}
                    {customTag ? (
                        <span className="text-[8px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-sm font-black tracking-tighter uppercase shadow-sm border border-emerald-500/50">{customTag}</span>
                    ) : (
                        isEmerald && <span className="text-[8px] bg-emerald-600/80 text-white px-1 rounded-sm font-black tracking-tighter uppercase">TRANSLATION</span>
                    )}
                    <span className={`text-[10px] font-black uppercase tracking-wider ${isIncoming ? 'text-slate-400' : 'text-blue-400'}`}>
                        {isIncoming ? 'Customer' : (AGENT_MAP[msg.userId.toString()] || 'Agent')}
                    </span>
                    <span className="text-[10px] text-slate-500">{msg.createdAt}</span>
                </div>
                <div className={`${bubbleBaseClass} ${isIncoming ? incomingClass : outgoingClass} ${isEmerald ? 'ring-1 ring-emerald-500/20' : ''}`}>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.bodyText}</div>
                </div>
            </div>
        );
    };

    // === 暴露能力给父组件 ===
    React.useImperativeHandle(ref, () => ({
        handleAiTranslate: (autoSave: boolean = false) => handleAiTranslate(autoSave),
        handleTriggerAiReply: (autoSave: boolean = false) => handleTriggerAiReply(autoSave),
        getTicketId: () => ticket.id
    }), [ticket.id, handleAiTranslate, handleTriggerAiReply]);

    return (
        <div className="h-full flex flex-col bg-slate-900 overflow-hidden relative">
            {/* Header */}
            <div className="flex-none p-3 border-b border-slate-700/50 flex items-center justify-between bg-slate-800/40 backdrop-blur-sm z-10">
                <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                        <h2 className="text-xs font-black text-white truncate max-w-[300px] leading-tight flex items-center gap-2">
                            <span className="text-blue-400">#{ticket.externalId}</span> {ticket.subject}
                        </h2>
                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">{ticket.status}</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={() => handleToggleShadow(notebookConfig?.notebookId, notebookConfig?.notebookUrl)} className={`px-3 py-1.5 rounded-md text-[10px] font-black transition-all ${shadowVisible ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                        BROWSER {shadowVisible ? 'ON' : 'OFF'}
                    </button>
                    <button
                        onClick={() => handleAiTranslate(false)}
                        disabled={isTranslating || generatingAiReply || isProcessing}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-md text-[10px] font-black transition-all"
                    >
                        {isTranslating ? 'TRANSLATING...' : 'AI TRANSLATE'}
                    </button>
                    <button
                        onClick={() => handleTriggerAiReply(false)}
                        disabled={generatingAiReply || isTranslating || isProcessing}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md text-[10px] font-black transition-all"
                    >
                        {generatingAiReply ? 'GENERATING...' : 'AI REPLY'}
                    </button>

                    {/* New MQ Trigger Buttons */}
                    <div className="w-px h-4 bg-slate-700 mx-1"></div>
                    <button
                        onClick={handleTriggerMqTranslate}
                        disabled={isTranslating || generatingAiReply || isProcessing || mqSubmitting}
                        className="px-3 py-1.5 border border-purple-500/50 text-purple-400 hover:bg-purple-500/10 disabled:opacity-50 rounded-md text-[10px] font-black transition-all"
                        title="Trigger Server-side MQ Translation"
                    >
                        {mqSubmitting ? 'SENDING...' : 'MQ TRANS'}
                    </button>
                    <button
                        onClick={handleTriggerMqReply}
                        disabled={generatingAiReply || isTranslating || isProcessing || mqSubmitting}
                        className="px-3 py-1.5 border border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50 rounded-md text-[10px] font-black transition-all"
                        title="Trigger Server-side MQ Reply"
                    >
                        {mqSubmitting ? 'SENDING...' : 'MQ REPLY'}
                    </button>

                    <div className="w-px h-4 bg-slate-700 mx-1"></div>
                    <button onClick={() => setIsJsonMode(!isJsonMode)} className={`px-3 py-1.5 rounded-md text-[10px] font-black border ${isJsonMode ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-400'}`}>
                        JSON
                    </button>
                    <button onClick={() => setIsSplitMode(!isSplitMode)} className={`px-3 py-1.5 rounded-md text-[10px] font-black border ${isSplitMode ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-400'}`}>
                        SPLIT
                    </button>
                </div>
            </div>

            {/* Translation Confirmation Bar */}
            {isTranslationDiffMode && tempTranslation && (
                <TranslationPreviewBar
                    submitting={submitting}
                    onCancel={() => setGlobalTempTranslation(ticket.id, null)}
                    onConfirm={handleConfirmTranslation}
                />
            )}

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                {isJsonMode ? (
                    <pre className="text-[10px] text-emerald-400/80 bg-black/40 p-4 rounded-lg border border-slate-800 font-mono whitespace-pre-wrap break-all">
                        {JSON.stringify(ticket, null, 2)}
                    </pre>
                ) : (
                    <>
                        <div className="space-y-6 relative">
                            {isSplitMode && (
                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-slate-700/50 to-transparent pointer-events-none"></div>
                            )}
                            {combinedConversations.map((msg, idx) => {
                                const isAgent = !!AGENT_MAP[msg.userId.toString()];
                                // Description (-1) 始终在左；如果是客服 ID，则在右；否则按 incoming 字段
                                const isIncoming = (msg.id === -1) ? true : (msg.incoming !== false && !isAgent);
                                const isDesc = msg.id === -1;

                                // 翻译匹配逻辑
                                let oldTransMsg = null;
                                let newTransMsg = null;

                                if (isDesc) {
                                    if (oldTranslation?.description) oldTransMsg = { bodyText: oldTranslation.description };
                                    if (newTranslation?.description) newTransMsg = { bodyText: newTranslation.description };
                                } else {
                                    oldTransMsg = oldTranslation?.conversations?.find(c => c.id === msg.id);
                                    newTransMsg = newTranslation?.conversations?.find(c => c.id === msg.id);
                                }

                                return (
                                    <div key={idx} className="w-full">
                                        <div className={`grid ${isSplitMode ? 'grid-cols-2 gap-16' : 'grid-cols-1 gap-3'} w-full items-start`}>
                                            <div className="min-w-0 w-full flex flex-col gap-2">
                                                {/* 原文气泡 */}
                                                {renderChatBubble(msg, isIncoming, false, isDesc)}

                                                {/* 非分栏模式下，紧跟展示翻译气泡 */}
                                                {!isSplitMode && (
                                                    <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-300">
                                                        {oldTransMsg && renderChatBubble({ ...oldTransMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc)}
                                                        {newTransMsg && renderChatBubble({ ...newTransMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc, "Gemini Preview")}
                                                    </div>
                                                )}
                                            </div>

                                            {isSplitMode && (
                                                <div className="min-w-0 w-full flex flex-col gap-2">
                                                    {oldTransMsg && renderChatBubble({ ...oldTransMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc)}

                                                    {newTransMsg && renderChatBubble({ ...newTransMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc, "Gemini Preview")}

                                                    {!oldTransMsg && !newTransMsg && (
                                                        <div className="h-full flex items-center justify-center border border-dashed border-slate-700 rounded-lg py-6 text-slate-600 text-[10px] italic">
                                                            No translation available
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* AI 回复与历史回复容器 */}
                        {(generatingAiReply || aiReplyText || mqStreamingText || (ticket.replies && ticket.replies.length > 0)) && (
                            <div className="space-y-4 pt-10 border-t border-slate-800/80">
                                <div className="flex items-center justify-between px-1">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-4 bg-purple-500 rounded-full animate-pulse"></div>
                                        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">NotebookLM AI Suggestion</h3>
                                    </div>
                                    {generatingAiReply && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] text-purple-400 font-bold animate-pulse italic">SMART THINKING...</span>
                                            <div className="w-2 h-2 rounded-full bg-purple-500 animate-ping"></div>
                                        </div>
                                    )}
                                </div>

                                <AiReplyPanel
                                    generatingAiReply={generatingAiReply}
                                    aiReplyText={aiReplyText}
                                    mqStreamingText={mqStreamingText}
                                    aiError={aiError}
                                    aiReplies={aiReplies}
                                    aiReplyLang={aiReplyLang}
                                    setAiReplyLang={setAiReplyLang}
                                    tempAiReply={tempAiReply}
                                    submitting={submitting}
                                    showPrompts={showPrompts}
                                    setShowPrompts={setShowPrompts}
                                    currentPrompt={currentPrompt}
                                    isSplitMode={isSplitMode}
                                    aiResponseEndRef={aiResponseEndRef}
                                    onClose={() => { setAiReplyText(''); setAiError(null); onProcessStatusChange?.(ticket.id, null); }}
                                    onDiscard={() => { setTempAiReply(null); setAiReplies(null); setAiReplyText(''); }}
                                    onConfirmReply={handleConfirmReply}
                                />

                                <ReplyHistoryPanel
                                    replies={ticket.replies || []}
                                    ticketStatus={ticket.status}
                                    submitting={auditSubmitting}
                                    onSubmitAudit={handleSubmitAudit}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* AI 翻译锁屏动画（仅翻译时显示，Reply过程中不锁屏以便查看浏览器状态）*/}
            {isTranslating ? (
                <div className="absolute inset-0 z-[200] backdrop-blur-[2px] flex items-center justify-center animate-in fade-in duration-500">
                    <style dangerouslySetInnerHTML={{
                        __html: `
                        @keyframes shimmer_move {
                            0% { transform: translateX(-100%); }
                            100% { transform: translateX(100%); }
                        }
                        .animate-shimmer {
                            animation: shimmer_move 2s infinite;
                        }
                    ` }} />
                    <div className="absolute inset-0 bg-slate-950/40"></div>

                    {/* 呼吸灯背景 */}
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        <div className="absolute -inset-[100%] opacity-20 bg-[conic-gradient(from_0deg,transparent_0%,#3b82f6_25%,transparent_50%,#8b5cf6_75%,transparent_100%)] animate-[spin_8s_linear_infinite]"></div>
                    </div>

                    <div className="relative group">
                        {/* 流光边框 */}
                        <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-2xl blur-lg opacity-75 animate-pulse"></div>

                        <div className="relative bg-slate-900 border border-white/10 rounded-2xl p-8 flex flex-col items-center gap-6 shadow-2xl min-w-[320px]">
                            {/* AI 核心动画 */}
                            <div className="relative w-20 h-20">
                                <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
                                <div className="absolute inset-0 border-4 border-t-blue-500 rounded-full animate-spin"></div>
                                <div className="absolute inset-2 border-4 border-purple-500/20 rounded-full"></div>
                                <div className="absolute inset-2 border-4 border-b-purple-500 rounded-full animate-[spin_2s_linear_infinite_reverse]"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-4 h-4 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)] animate-pulse"></div>
                                </div>
                            </div>

                            <div className="text-center space-y-2">
                                <h3 className="text-lg font-black text-white tracking-widest uppercase">
                                    AI Translating
                                </h3>
                                <div className="flex flex-col items-center gap-1">
                                    <p className="text-xs text-slate-400 font-medium animate-pulse">
                                        Optimizing linguistics & tone...
                                    </p>
                                    <div className="flex gap-1 mt-2">
                                        <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                        <div className="w-1 h-1 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                        <div className="w-1 h-1 bg-pink-500 rounded-full animate-bounce"></div>
                                    </div>
                                </div>
                            </div>

                            {/* 扫描线动画 */}
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50 blur-sm overflow-hidden">
                                <div className="h-full w-full bg-blue-400/30 animate-shimmer"></div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
});

export default ServerTicketDetail;
