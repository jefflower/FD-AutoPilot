import React, { useState } from 'react';
import { ServerTicket } from '../../types/server';
import { serverApi } from '../../services/serverApi';
import { LangLabel } from '../Common';
import { useSettings } from '../../hooks/useSettings';
import { useNotebookShadow } from '../../hooks/useNotebookShadow';
import { NotebookShadowService } from '../../services/notebookShadow';
import { invoke } from '@tauri-apps/api/core';

interface ServerTicketDetailProps {
    ticket: ServerTicket;
    displayLang?: 'original' | 'cn' | 'en';
    setDisplayLang?: (l: 'original' | 'cn' | 'en') => void;
    onRefresh?: () => void;
    isEmbed?: boolean;
    isProcessing?: boolean;
    isSplitMode?: boolean;
    setIsSplitMode?: (s: boolean) => void;
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

// 员工 ID 映射配置表
const AGENT_MAP: Record<string, string> = {
    "158001343601": "Simsonn1",
    "158000445778": "Simsonn2",
    "158007774607": "Simsonn3",
};

const ServerTicketDetail: React.FC<ServerTicketDetailProps> = ({
    ticket,
    onRefresh,
    isEmbed = false,
    isProcessing = false,
    isSplitMode: propIsSplitMode,
    setIsSplitMode: propSetIsSplitMode
}) => {
    const [submitting, setSubmitting] = useState(false);
    const { notebookLMConfig: notebookConfig } = useSettings();
    const { visible: shadowVisible, toggle: handleToggleShadow } = useNotebookShadow();
    const [generatingAiReply, setGeneratingAiReply] = useState(false);
    const [aiReplyText, setAiReplyText] = useState('');

    // 优先使用外部传入的分栏状态
    const [internalIsSplitMode, setInternalIsSplitMode] = useState(false);
    const isSplitMode = propIsSplitMode !== undefined ? propIsSplitMode : internalIsSplitMode;
    const setIsSplitMode = (s: boolean) => {
        if (propSetIsSplitMode) propSetIsSplitMode(s);
        else setInternalIsSplitMode(s);
    };

    // 审核面板状态
    const [auditState, setAuditState] = useState<{ replyId: number | null, result: 'PASS' | 'REJECT', remark: string }>({
        replyId: null,
        result: 'PASS',
        remark: ''
    });

    const parseJsonContent = (content: string | undefined): ParsedContent | null => {
        if (!content) return null;
        try {
            const data = JSON.parse(content);
            if (data && typeof data === 'object') return data;
        } catch (e) { }
        return null;
    };

    const parsedData = React.useMemo(() => parseJsonContent(ticket.content), [ticket.content]);
    const parsedTranslation = React.useMemo(() =>
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

    const handleTriggerAiReply = async () => {
        if (isProcessing || generatingAiReply) return;
        if (!notebookConfig?.notebookId) {
            alert('请先在“设置”中配置 Notebook ID');
            return;
        }

        setGeneratingAiReply(true);
        setAiReplyText('');
        try {
            const context = `Subject: ${ticket.subject}\n\nDescription: ${parsedData?.description || 'No description'}\n\nConversations:\n${parsedData?.conversations?.map(c => `${c.incoming ? 'Customer' : 'Agent'}: ${c.bodyText}`).join('\n')}`;
            const promptTemplate = notebookConfig.prompt || '请根据以下工单内容回答我的问题:\n\n${工单内容}';
            const finalPrompt = promptTemplate.replace('${工单内容}', context);

            const shadowService = new NotebookShadowService(notebookConfig.notebookId);
            let lastText = '';
            for await (const chunk of shadowService.query(finalPrompt)) {
                setAiReplyText(chunk.text);
            }
        } catch (e) {
            console.error('AI Reply Error:', e);
            alert('AI 生成失败: ' + (e as Error).message);
        } finally {
            setGeneratingAiReply(false);
        }
    };

    const handleSubmitAudit = async () => {
        if (!auditState.replyId || submitting) return;
        setSubmitting(true);
        try {
            await serverApi.ticket.submitAudit(ticket.id, {
                replyId: auditState.replyId,
                auditResult: auditState.result,
                auditRemark: auditState.remark
            });
            setAuditState({ replyId: null, result: 'PASS', remark: '' });
            onRefresh?.();
        } catch (e) {
            alert('审核提交失败: ' + (e as Error).message);
        } finally {
            setSubmitting(false);
        }
    };

    const [isJsonMode, setIsJsonMode] = useState(false);

    const renderChatBubble = (msg: any, isIncoming: boolean, isEmerald: boolean = false, isDesc: boolean = false) => {
        const bubbleBaseClass = "p-3 rounded-lg shadow-sm transition-all duration-200 break-all overflow-wrap-anywhere min-w-0 max-w-[90%]";
        const incomingClass = isEmerald ? "bg-emerald-900/40 text-emerald-100 border border-emerald-700/50" : "bg-slate-700/60 text-slate-100 border border-slate-600/50";
        const outgoingClass = "bg-blue-600/30 text-blue-50 border border-blue-500/30";

        return (
            <div className={`flex flex-col ${isIncoming ? 'items-start' : 'items-end'} w-full min-w-0`}>
                <div className={`flex items-center gap-2 mb-1 px-1 ${isIncoming ? '' : 'flex-row-reverse'}`}>
                    {isDesc && <span className="text-[10px] bg-indigo-500 text-white px-1 rounded-sm font-bold">DESC</span>}
                    {isEmerald && <span className="text-[8px] bg-emerald-600/80 text-white px-1 rounded-sm font-black tracking-tighter uppercase">TRANSLATION</span>}
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
                    <button onClick={handleToggleShadow} className={`px-3 py-1.5 rounded-md text-[10px] font-black transition-all ${shadowVisible ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                        BROWSER {shadowVisible ? 'ON' : 'OFF'}
                    </button>
                    <button onClick={handleTriggerAiReply} disabled={generatingAiReply} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md text-[10px] font-black transition-all">
                        {generatingAiReply ? 'GENERATING...' : 'AI REPLY'}
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
                                let transMsg = null;
                                if (isDesc) {
                                    if (parsedTranslation?.description) transMsg = { bodyText: parsedTranslation.description };
                                } else {
                                    transMsg = parsedTranslation?.conversations?.find(c => c.id === msg.id);
                                }

                                return (
                                    <div key={idx} className="w-full">
                                        <div className={`grid ${isSplitMode ? 'grid-cols-2 gap-16' : 'grid-cols-1 gap-3'} w-full items-start`}>
                                            <div className="min-w-0 w-full flex flex-col gap-2">
                                                {/* 原文气泡 */}
                                                {renderChatBubble(msg, isIncoming, false, isDesc)}

                                                {/* 非分栏模式下，紧跟展示翻译气泡 */}
                                                {!isSplitMode && transMsg && (
                                                    <div className="animate-in fade-in slide-in-from-top-1 duration-300">
                                                        {renderChatBubble({ ...transMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc)}
                                                    </div>
                                                )}
                                            </div>

                                            {isSplitMode && (
                                                <div className="min-w-0 w-full">
                                                    {transMsg ? (
                                                        renderChatBubble({ ...transMsg, userId: msg.userId, createdAt: msg.createdAt }, isIncoming, true, isDesc)
                                                    ) : (
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

                        {/* AI Replies & Existing Replies */}
                        {(aiReplyText || (ticket.replies && ticket.replies.length > 0)) && (
                            <div className="space-y-4 pt-8 border-t border-slate-800">
                                <div className="flex items-center gap-2 px-1">
                                    <div className="w-1.5 h-4 bg-orange-500 rounded-full"></div>
                                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">AI & REPLIES</h3>
                                </div>

                                {/* 手动触发生成的 AI 回复 */}
                                {aiReplyText && (
                                    <div className="p-5 bg-orange-900/10 rounded-xl border border-orange-500/20 shadow-orange-500/5">
                                        <div className="flex items-center justify-between mb-3 border-b border-orange-500/10 pb-2">
                                            <span className="text-[10px] font-black text-orange-400 uppercase">NEW AI RECOMMENDATION</span>
                                            <span className="text-[10px] text-orange-500/50 italic">Just generated</span>
                                        </div>
                                        <div className="text-sm text-orange-50/90 leading-loose whitespace-pre-wrap font-medium">
                                            {aiReplyText}
                                        </div>
                                    </div>
                                )}

                                {/* 工单已有的回复列表 */}
                                {ticket.replies?.map(reply => (
                                    <div key={reply.id} className="p-5 bg-slate-800/40 rounded-xl border border-slate-700/50 space-y-4">
                                        <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">REPLY #{reply.id}</span>
                                            <span className="text-[10px] text-slate-500">{reply.createdAt}</span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <div className="text-[10px] font-bold text-slate-500">ZH REPLY</div>
                                                <div className="text-sm text-slate-200 bg-black/20 p-3 rounded-lg border border-white/5">{reply.zhReply}</div>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="text-[10px] font-bold text-slate-500">TARGET REPLY ({reply.replyLang})</div>
                                                <div className="text-sm text-slate-200 bg-black/20 p-3 rounded-lg border border-white/5">{reply.targetReply}</div>
                                            </div>
                                        </div>

                                        {/* 审核面板 */}
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
                                                            onClick={handleSubmitAudit}
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
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default ServerTicketDetail;
