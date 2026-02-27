import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ServerTicket } from '../../../shared/types/server';
import { serverApi } from '../../../shared/services/serverApi';
import { useNotebookShadow } from '../../../tauri/hooks/useNotebookShadow';
import { AgentRegistry } from '../../../shared/agents/AgentRegistry';
import { useTicketProcess } from '../../../shared/hooks/useTicketProcess';
import { useAiReply } from '../../../shared/hooks/useAiReply';
import { useAiTranslation } from '../../../shared/hooks/useAiTranslation';
import { AGENT_MAP } from '../../../shared/constants/agentMap';
import { isTauriEnv } from '../../../tauri/bridge';
import TranslationPreviewBar from './ticket-detail/TranslationPreviewBar';

// Web 兼容的对话框函数
async function compatAsk(msg: string, options?: { title?: string; kind?: string }): Promise<boolean> {
    if (isTauriEnv()) {
        const { ask } = await import('@tauri-apps/plugin-dialog');
        return ask(msg, options as any);
    }
    return window.confirm(msg);
}

async function compatMessage(msg: string, options?: { title?: string; kind?: string }): Promise<void> {
    if (isTauriEnv()) {
        const { message } = await import('@tauri-apps/plugin-dialog');
        await message(msg, options as any);
        return;
    }
    window.alert(msg);
}
import AiReplyPanel from './ticket-detail/AiReplyPanel';
import ReplyHistoryPanel from './ticket-detail/ReplyHistoryPanel';

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
    isProcessing?: boolean;
    isSplitMode?: boolean;
    setIsSplitMode?: (s: boolean) => void;
    activeProcessType?: 'translating' | 'replying' | null;
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
}, ref) => {
    const { t } = useTranslation(['tickets', 'common']);
    const [submitting, setSubmitting] = useState(false);
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

    // MQ 流式文本：从全局 processState 读取（MQReplyContext 写入的跨组件数据通道）
    const { getProcessState } = useTicketProcess();
    const mqStreamingText = getProcessState(ticket.id).streamingText || '';

    // 临时保存的AI回复（手动触发时使用，需用户确认后才保存）
    const [tempAiReply, setTempAiReply] = useState<[string, string] | null>(null);

    // 手动操作本地状态
    const [manualTranslating, setManualTranslating] = useState(false);
    const [manualReplying, setManualReplying] = useState(false);

    // 临时翻译数据（手动翻译的 diff 展示）— 本地管理
    const [tempTranslation, setTempTranslation] = useState<Partial<import('../../../shared/types/server').TicketTranslation> | null>(null);

    // 三源合并：MQ 自动化 | 后端状态 | 手动操作
    // PROCESSING 状态下，通过 activeProcessType 区分翻译/回复
    const isTranslating = (isProcessing && activeProcessType === 'translating')
        || manualTranslating;
    const generatingAiReply = (isProcessing && activeProcessType === 'replying')
        || manualReplying;

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

    // === 状态监控日志（包含变为 false 的记录，帮助诊断闪烁） ===
    useEffect(() => {
        console.log(`[StatusBar] isTranslating=${isTranslating}, generatingAiReply=${generatingAiReply}, ticket=#${ticket.id}, status=${ticket.status}, activeProcessType=${activeProcessType}, manualTranslating=${manualTranslating}, manualReplying=${manualReplying}`);
    }, [isTranslating, generatingAiReply, ticket.id, ticket.status, activeProcessType, manualTranslating, manualReplying]);

    // === 状态派生：处理状态完全由父组件 prop 驱动，确保跨组件卸载持久化 ===
    // (已移动到上方 useState 处合并定义)

    // === 状态重置：切换工单时清空局部 UI 状态 ===
    useEffect(() => {
        console.log(`[ServerTicketDetail] Ticket ID changed to #${ticket.id}, activeProcessType from parent: ${activeProcessType}`);
        // 局部 UI 状态重置
        setAiError(null);
        setAiReplies(null);
        setAiReplyText('');
        setManualTranslating(false);
        setManualReplying(false);
        setTempTranslation(null);
        setTempAiReply(null);
    }, [ticket.id]);

    // === MQ 任务完成后自动刷新工单详情 ===
    useEffect(() => {
        const handler = (e: Event) => {
            const { ticketId } = (e as CustomEvent).detail || {};
            if (ticketId === ticket.id) {
                console.log(`[ServerTicketDetail] ticket-task-completed for #${ticketId}, refreshing`);
                onRefresh?.();
            }
        };
        window.addEventListener('ticket-task-completed', handler);
        return () => window.removeEventListener('ticket-task-completed', handler);
    }, [ticket.id, onRefresh]);

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
        setManualTranslating(true);

        try {
            const success = await runTranslation(ticket, {
                autoSave,
                onError: (err) => { setAiError(err); if (!autoSave) alert(t('detail.translationFailed', { error: err })); },
                onResult: (data) => {
                    if (!autoSave) setTempTranslation(data);
                },
            });

            if (success && autoSave) onRefresh?.();
            return success;
        } finally {
            setManualTranslating(false);
        }
    }, [ticket, runTranslation, isTranslating, generatingAiReply, isProcessing, onRefresh, t]);

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
            setTempTranslation(null);

            // 3. 通知父组件刷新（背景同步）
            if (onRefresh) {
                onRefresh();
            }
        } catch (e) {
            console.error('[SubmitTranslation] Failed:', e);
            alert(t('detail.saveTranslationFailed', { error: (e as Error).message }));
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
        setManualReplying(true);

        try {
            const success = await runReply(ticket, {
                autoSave,
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
        } finally {
            setManualReplying(false);
        }
    }, [ticket, runReply, generatingAiReply, isTranslating, isProcessing, onRefresh]);

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
            alert(t('detail.saveReplyFailed', { error: (e as Error).message }));
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
            alert(t('detail.auditSubmitFailed', { error: (e as Error).message }));
        } finally {
            setAuditSubmitting(false);
        }
    };

    const [mqSubmitting, setMqSubmitting] = useState(false);

    const handleRestartWorkflow = async () => {
        if (mqSubmitting) return;

        const confirmed = await compatAsk(t('mq.restartWorkflowConfirmMessage', { defaultValue: '确认重启此工单的工作流？翻译和回复将并行重新执行。' }), {
            title: t('mq.restartWorkflowConfirmTitle', { defaultValue: '重启工作流' }),
            kind: 'warning'
        });

        if (!confirmed) return;

        setMqSubmitting(true);
        try {
            await serverApi.ticket.restartWorkflow(ticket.id);
            await compatMessage(t('mq.restartWorkflowSentMessage', { defaultValue: '工作流已重启，翻译和回复任务将并行执行。' }), {
                title: t('mq.restartWorkflowSentTitle', { defaultValue: '已提交' }),
                kind: 'info'
            });
            onRefresh?.();
        } catch (e) {
            console.error('Restart Workflow Error:', e);
            await compatMessage(t('mq.restartWorkflowErrorMessage', { error: (e as Error).message, defaultValue: `重启工作流失败: ${(e as Error).message}` }), {
                title: t('mq.restartWorkflowErrorTitle', { defaultValue: '操作失败' }),
                kind: 'error'
            });
        } finally {
            setMqSubmitting(false);
        }
    };

    /** @deprecated 保留向后兼容，实际调用 restartWorkflow */
    const handleTriggerMqTranslate = handleRestartWorkflow;
    /** @deprecated 保留向后兼容，实际调用 restartWorkflow */
    const handleTriggerMqReply = handleRestartWorkflow;

    const [isJsonMode, setIsJsonMode] = useState(false);

    const renderChatBubble = (msg: any, isIncoming: boolean, isEmerald: boolean = false, isDesc: boolean = false, customTag?: string) => {
        const bubbleBaseClass = "p-3 rounded-lg shadow-sm transition-all duration-200 break-all overflow-wrap-anywhere min-w-0 max-w-[90%]";
        const incomingClass = isEmerald ? "bg-emerald-900/40 text-emerald-100 border border-emerald-700/50" : "bg-slate-700/60 text-slate-100 border border-slate-600/50";
        const outgoingClass = "bg-blue-600/30 text-blue-50 border border-blue-500/30";

        return (
            <div className={`flex flex-col ${isIncoming ? 'items-start' : 'items-end'} w-full min-w-0`}>
                <div className={`flex items-center gap-2 mb-1 px-1 ${isIncoming ? '' : 'flex-row-reverse'}`}>
                    {isDesc && <span className="text-[10px] bg-indigo-500 text-white px-1 rounded-sm font-bold shadow-sm">{t('detail.descTag')}</span>}
                    {customTag ? (
                        <span className="text-[8px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-sm font-black tracking-tighter uppercase shadow-sm border border-emerald-500/50">{customTag}</span>
                    ) : (
                        isEmerald && <span className="text-[8px] bg-emerald-600/80 text-white px-1 rounded-sm font-black tracking-tighter uppercase">{t('detail.translationTag')}</span>
                    )}
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
                        <h2 className="text-xs font-black text-white truncate max-w-[400px] leading-tight flex items-center gap-2">
                            <span className="text-blue-400">#{ticket.externalId}</span>
                            <span className="text-[9px] text-slate-500 font-mono">ID:{ticket.id}</span>
                            {ticket.subject}
                        </h2>
                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">{t(`common:ticketStatus.${ticket.status}` as any)}</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={() => {
                        const registry = AgentRegistry.getInstance();
                        const resolved = registry.resolveByCapability('reply');
                        const replyDef = resolved?.definition;
                        const cfg = replyDef ? (typeof replyDef.providerConfig === 'string' ? JSON.parse(replyDef.providerConfig || '{}') : replyDef.providerConfig) : {};
                        handleToggleShadow(cfg?.notebookId, cfg?.notebookUrl);
                    }} className={`px-3 py-1.5 rounded-md text-[10px] font-black transition-all ${shadowVisible ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                        {shadowVisible ? t('detail.browserOn') : t('detail.browserOff')}
                    </button>
                    <button
                        onClick={() => handleAiTranslate(false)}
                        disabled={isTranslating || generatingAiReply || isProcessing}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-md text-[10px] font-black transition-all"
                    >
                        {isTranslating ? t('detail.translatingBtn') : t('detail.aiTranslateBtn')}
                    </button>
                    <button
                        onClick={() => handleTriggerAiReply(false)}
                        disabled={generatingAiReply || isTranslating || isProcessing}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md text-[10px] font-black transition-all"
                    >
                        {generatingAiReply ? t('detail.generatingBtn') : t('detail.aiReplyBtn')}
                    </button>

                    {/* New MQ Trigger Buttons */}
                    <div className="w-px h-4 bg-slate-700 mx-1"></div>
                    <button
                        onClick={handleTriggerMqTranslate}
                        disabled={isTranslating || generatingAiReply || isProcessing || mqSubmitting}
                        className="px-3 py-1.5 border border-purple-500/50 text-purple-400 hover:bg-purple-500/10 disabled:opacity-50 rounded-md text-[10px] font-black transition-all"
                        title={t('detail.mqTransTooltip')}
                    >
                        {mqSubmitting ? t('detail.sendingBtn') : t('detail.mqTransBtn')}
                    </button>
                    <button
                        onClick={handleTriggerMqReply}
                        disabled={generatingAiReply || isTranslating || isProcessing || mqSubmitting}
                        className="px-3 py-1.5 border border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50 rounded-md text-[10px] font-black transition-all"
                        title={t('detail.mqReplyTooltip')}
                    >
                        {mqSubmitting ? t('detail.sendingBtn') : t('detail.mqReplyBtn')}
                    </button>

                    <div className="w-px h-4 bg-slate-700 mx-1"></div>
                    <button onClick={() => setIsJsonMode(!isJsonMode)} className={`px-3 py-1.5 rounded-md text-[10px] font-black border ${isJsonMode ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-400'}`}>
                        JSON
                    </button>
                    <button onClick={() => setIsSplitMode(!isSplitMode)} className={`px-3 py-1.5 rounded-md text-[10px] font-black border ${isSplitMode ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-400'}`}>
                        {t('detail.splitBtn')}
                    </button>
                </div>
            </div>

            {/* Translation Confirmation Bar */}
            {isTranslationDiffMode && tempTranslation && (
                <TranslationPreviewBar
                    submitting={submitting}
                    onCancel={() => setTempTranslation(null)}
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
                                                        {newTransMsg && renderChatBubble({ ...newTransMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc, t('detail.geminiPreview'))}
                                                    </div>
                                                )}
                                            </div>

                                            {isSplitMode && (
                                                <div className="min-w-0 w-full flex flex-col gap-2">
                                                    {oldTransMsg && renderChatBubble({ ...oldTransMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc)}

                                                    {newTransMsg && renderChatBubble({ ...newTransMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc, t('detail.geminiPreview'))}

                                                    {!oldTransMsg && !newTransMsg && (
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

                        {/* AI 建议区块：仅在 AI 回复活动时显示 */}
                        {(generatingAiReply || aiReplyText || mqStreamingText || tempAiReply || aiReplies) && (
                            <div className="space-y-4 pt-10 border-t border-slate-800/80">
                                <div className="flex items-center justify-between px-1">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-4 bg-purple-500 rounded-full animate-pulse"></div>
                                        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">{t('detail.aiSuggestionTitle')}</h3>
                                    </div>
                                    {generatingAiReply && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] text-purple-400 font-bold animate-pulse italic">{t('detail.aiThinking')}</span>
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
                                    onClose={() => { setAiReplyText(''); setAiError(null); }}
                                    onDiscard={() => { setTempAiReply(null); setAiReplies(null); setAiReplyText(''); }}
                                    onConfirmReply={handleConfirmReply}
                                />
                            </div>
                        )}

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
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* 任务状态条（始终挂载，CSS 控制可见性，避免 DOM 删除/重建导致闪烁） */}
            <div
                className={`absolute top-[52px] left-0 right-0 z-20 pointer-events-none flex flex-col transition-opacity duration-150 ${
                    (isTranslating || generatingAiReply) ? 'opacity-100' : 'opacity-0'
                }`}
            >
                <div
                    className={`flex items-center gap-2 px-3 py-1.5 bg-emerald-950/80 border-b border-emerald-500/20 transition-all duration-150 ${
                        isTranslating ? 'max-h-10 opacity-100' : 'max-h-0 opacity-0 overflow-hidden py-0 border-0'
                    }`}
                >
                    <div className="relative w-3.5 h-3.5 flex-shrink-0">
                        <div className="absolute inset-0 border-2 border-emerald-500/30 rounded-full"></div>
                        <div className="absolute inset-0 border-2 border-t-emerald-400 rounded-full animate-spin"></div>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-400 tracking-wide">{t('detail.aiTranslatingTitle')}</span>
                    <div className="flex gap-0.5 ml-1">
                        <div className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                        <div className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                        <div className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce"></div>
                    </div>
                </div>
                <div
                    className={`flex items-center gap-2 px-3 py-1.5 bg-purple-950/80 border-b border-purple-500/20 transition-all duration-150 ${
                        generatingAiReply ? 'max-h-10 opacity-100' : 'max-h-0 opacity-0 overflow-hidden py-0 border-0'
                    }`}
                >
                    <div className="relative w-3.5 h-3.5 flex-shrink-0">
                        <div className="absolute inset-0 border-2 border-purple-500/30 rounded-full"></div>
                        <div className="absolute inset-0 border-2 border-t-purple-400 rounded-full animate-spin"></div>
                    </div>
                    <span className="text-[10px] font-bold text-purple-400 tracking-wide">{t('detail.aiThinking')}</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping ml-1"></div>
                </div>
            </div>
        </div>
    );
});

export default ServerTicketDetail;
