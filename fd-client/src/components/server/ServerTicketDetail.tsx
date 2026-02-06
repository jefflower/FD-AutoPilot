import React, { useState, useCallback, useEffect } from 'react';
import { ServerTicket } from '../../types/server';
import { serverApi } from '../../services/serverApi';
import { useSettings } from '../../hooks/useSettings';
import { useNotebookShadow } from '../../hooks/useNotebookShadow';
import { NotebookShadowService } from '../../services/notebookShadow';
import { useTicketProcess } from '../../hooks/useTicketProcess';
import { invoke } from '@tauri-apps/api/core';
import { ask, message } from '@tauri-apps/plugin-dialog';

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

// 员工 ID 映射配置表
const AGENT_MAP: Record<string, string> = {
    "158001343601": "Simsonn1",
    "158000445778": "Simsonn2",
    "158007774607": "Simsonn3",
};

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
    const { notebookLMConfig: notebookConfig, translationLang } = useSettings();
    const { visible: shadowVisible, toggle: handleToggleShadow } = useNotebookShadow();
    // const [generatingAiReply, setGeneratingAiReply] = useState(false); // 改为 prop 驱动
    const [aiReplyText, setAiReplyText] = useState('');
    const [aiReplies, setAiReplies] = useState<[string, string] | null>(null); // [工单语言, 中文]
    const [aiReplyLang, setAiReplyLang] = useState<'original' | 'cn'>('original');
    const [aiError, setAiError] = useState<string | null>(null);
    const [currentPrompt, setCurrentPrompt] = useState<string>(''); // 存储发给 AI 的完整提示词
    const [showPrompts, setShowPrompts] = useState(false); // 是否显示提示词视图
    const aiResponseEndRef = React.useRef<HTMLDivElement>(null);

    // 使用 ref 保存最新的 ticket，确保异步回调中使用正确的 ID
    const ticketRef = React.useRef(ticket);
    React.useEffect(() => {
        ticketRef.current = ticket;
    }, [ticket]);

    // AI 处理状态持久化 (从全局 Hook 获取)
    const { getProcessState, setProcessStatus, setTempTranslation: setGlobalTempTranslation, getActiveReplyingId, setActiveReplyingId } = useTicketProcess();
    const processState = getProcessState(ticket.id);

    // 临时保存的AI回复（手动触发时使用，需用户确认后才保存）
    const [tempAiReply, setTempAiReply] = useState<[string, string] | null>(null);

    const isTranslating = activeProcessType === 'translating' || processState.status === 'translating';
    const generatingAiReply = activeProcessType === 'replying' || processState.status === 'replying';

    const tempTranslation = processState.tempTranslation;
    const isTranslationDiffMode = !!tempTranslation;

    // 自动滚动 AI 回复到底部
    React.useEffect(() => {
        if (aiReplyText) {
            aiResponseEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [aiReplyText]);

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
        if (autoSave) console.log(`[ServerTicketDetail] handleAiTranslate (autoSave=true) for ticket #${ticket.id}`);

        if (!autoSave && (isTranslating || generatingAiReply || isProcessing)) {
            console.log(`[ServerTicketDetail] Translation blocked: isTranslating=${isTranslating}, generatingAiReply=${generatingAiReply}, isProcessing=${isProcessing}`);
            return false;
        }
        if (!autoSave && isTranslating) {
            console.log(`[ServerTicketDetail] Already translating ticket #${ticket.id}, ignoring redundant call.`);
            return true;
        }

        console.log(`[ServerTicketDetail] handleAiTranslate START for #${ticket.id}`);
        setProcessStatus(ticket.id, 'translating');
        onProcessStatusChange?.(ticket.id, 'translating');
        setAiError(null);

        try {
            // 构造 Rust 期望的 Ticket 结构
            const rustTicket = {
                id: ticket.id,
                externalId: ticket.externalId,
                subject: ticket.subject,
                descriptionText: parsedData?.description || '',
                content: ticket.content,
                status: ticket.status,
                priority: 0,
                createdAt: ticket.createdAt,
                conversations: (parsedData?.conversations || []).map(c => ({
                    id: c.id,
                    body_text: c.bodyText,
                    user_id: c.userId,
                    created_at: c.createdAt,
                    incoming: (c.incoming !== false && !AGENT_MAP[String(c.userId)]),
                    private: c.isPrivate || false,
                }))
            };

            // 使用配置的语言 (默认 zh-CN)
            // 使用配置的语言 (默认 zh-CN)，并将简写 'cn' 转换为标准 'zh-CN'
            let targetLang = translationLang || 'zh-CN';
            if (targetLang === 'cn') targetLang = 'zh-CN';

            console.log(`[ServerTicketDetail] Invoking translation with targetLang: ${targetLang}`);

            // 调用 Rust 命令进行直接翻译 (不依赖本地存储)
            const result = (await invoke('translate_ticket_direct_cmd', {
                ticket: rustTicket,
                targetLang: targetLang
            })) as any;

            console.log('[ServerTicketDetail] Translation Result RAW:', result);

            // 构造翻译后的 content (和服务端格式保持一致，即包含 description 和 conversations 的 JSON)
            const translatedConversations = result.conversations?.map((c: any) => ({
                id: c.id,
                bodyText: c.bodyText || c.body_text || '', // 兼容 camelCase 和 snake_case
                userId: c.userId || c.user_id,
                createdAt: c.createdAt || c.created_at,
                incoming: c.incoming,
                isPrivate: c.private || c.is_private
            })) || [];

            const finalTranslatedContent = JSON.stringify({
                description: result.descriptionText || result.description_text || '',
                conversations: translatedConversations
            });

            const translationData = {
                targetLang: targetLang,
                translatedTitle: result.subject || ticket.subject,
                translatedContent: finalTranslatedContent,
            };

            console.log('[TranslationData] Prepared:', {
                ticketId: ticket.id,
                targetLang: translationData.targetLang,
                titleLen: translationData.translatedTitle?.length,
                contentLen: translationData.translatedContent?.length,
                contentPreview: finalTranslatedContent.substring(0, 100)
            });

            if (autoSave) {
                console.log(`[ServerTicketDetail] autoSave triggered for ticket #${ticket.id}. Calling serverApi.ticket.submitTranslation...`);
                try {
                    await serverApi.ticket.submitTranslation(ticket.id, translationData);
                    console.log(`[ServerTicketDetail] serverApi.ticket.submitTranslation completed successfully for #${ticket.id}`);
                    onRefresh?.();
                } catch (saveErr) {
                    console.error(`[ServerTicketDetail] FATAL: autoSave failed for ticket #${ticket.id}:`, saveErr);
                    throw saveErr; // Rethrow to ensure handleAiTranslate returns false/catches in outer block
                }
            } else {
                setGlobalTempTranslation(ticket.id, translationData);
            }
            return true;
        } catch (e) {
            console.error('AI Translation Error:', e);
            const errMsg = (e as Error).message || String(e);
            setAiError(errMsg);
            if (!autoSave) alert('翻译失败: ' + errMsg);
            return false;
        } finally {
            console.log(`[ServerTicketDetail] handleAiTranslate END for #${ticket.id}`);
            setProcessStatus(ticket.id, null);
            onProcessStatusChange?.(ticket.id, null);
        }
    }, [ticket, parsedData, isTranslating, isProcessing, onRefresh, onProcessStatusChange, notebookConfig, translationLang]);

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
        // 使用 ref 获取最新的 ticket，防止闭包问题导致使用旧 ID
        const currentTicket = ticketRef.current;
        if (autoSave) console.log(`[ServerTicketDetail] handleTriggerAiReply (autoSave=true) for ticket #${currentTicket.id}`);

        if (!autoSave && (generatingAiReply || isTranslating || isProcessing)) {
            console.log(`[ServerTicketDetail] Reply blocked: generatingAiReply=${generatingAiReply}, isTranslating=${isTranslating}, isProcessing=${isProcessing}`);
            return false;
        }

        // 单任务互斥检测（仅限手动触发时检查）
        const currentActiveId = getActiveReplyingId();
        if (!autoSave && currentActiveId !== null && currentActiveId !== currentTicket.id) {
            alert(`工单 #${currentActiveId} 正在执行 AI Reply，请等待完成后再试。\n\n多任务并发 AI Reply 功能正在开发中...`);
            return false;
        }
        if (generatingAiReply) {
            console.log(`[ServerTicketDetail] Already generating reply for ticket #${currentTicket.id}, ignoring redundant call.`);
            return true;
        }
        if (!notebookConfig?.notebookId) {
            if (!autoSave) alert('请先在“设置”中配置 Notebook ID');
            return false;
        }

        console.log(`[ServerTicketDetail] handleTriggerAiReply START for #${currentTicket.id}`);
        setActiveReplyingId(currentTicket.id); // 设置互斥状态
        setProcessStatus(currentTicket.id, 'replying');
        onProcessStatusChange?.(currentTicket.id, 'replying');
        setAiReplyText('');
        setAiReplies(null);
        setTempAiReply(null); // 清理临时保存
        setAiError(null);

        try {
            // 深度构造上下文：包含明确的时间戳和角色标识
            let context = `【TICKET SUBJECT】: ${currentTicket.subject}\n`;
            context += `【INITIAL DESCRIPTION】: ${parsedData?.description || 'No description content'}\n\n`;

            if (parsedData?.conversations && parsedData.conversations.length > 0) {
                context += "【DETAILED INTERACTION LOGS】:\n";
                context += "--------------------------------------------------\n";
                for (const conv of parsedData.conversations) {
                    const userIdStr = String(conv.userId);
                    const agentName = AGENT_MAP[userIdStr];
                    const role = agentName ? `AGENT (${agentName})` : (conv.incoming ? 'CUSTOMER' : 'AGENT');

                    const timeStr = conv.createdAt || 'Unknown Time';
                    context += `[${timeStr}] <${role}>:\n${conv.bodyText}\n`;
                    context += "--------------------------------------------------\n";
                }
            }

            const promptTemplate = notebookConfig.prompt || '请根据以下工单内容回答我的问题:\n\n${工单内容}';
            const finalPrompt = promptTemplate.replace('${工单内容}', context);
            setCurrentPrompt(finalPrompt); // 保存当前 Prompt 用于查看

            const shadowService = new NotebookShadowService(notebookConfig.notebookId, notebookConfig.notebookUrl);
            let saveSuccess = false;
            let saveError: Error | null = null;

            for await (const chunk of shadowService.query(finalPrompt)) {
                if (chunk.status === 'error') {
                    setAiError(chunk.text);
                    break;
                }
                setAiReplyText(chunk.text);

                // 完全对齐老代码的解析逻辑 (TicketDetail.tsx:L114-150)
                if (chunk.status === 'complete' || (chunk.text.includes('[') && chunk.text.includes(']'))) {
                    try {
                        let textToParse = chunk.text.trim();
                        const startIdx = textToParse.indexOf('[');
                        const endIdx = textToParse.lastIndexOf(']');
                        if (startIdx !== -1 && endIdx > startIdx) {
                            textToParse = textToParse.substring(startIdx, endIdx + 1);
                        }

                        let parsed = null;
                        try {
                            parsed = JSON.parse(textToParse);
                        } catch {
                            const match = textToParse.match(/^\[\s*"([\s\S]*?)"\s*,\s*"([\s\S]*?)"\s*\]$/);
                            if (match) {
                                const str1 = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                                const str2 = match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                                parsed = [str1, str2];
                            }
                        }

                        if (parsed && Array.isArray(parsed) && parsed.length >= 2) {
                            setAiReplies([parsed[0], parsed[1]]);

                            // 如果是自动保存模式（MQ触发）
                            if (autoSave) {
                                try {
                                    await serverApi.ticket.submitReply(currentTicket.id, {
                                        zhReply: parsed[1],
                                        targetReply: parsed[0]
                                    });
                                    onRefresh?.();
                                    saveSuccess = true;
                                    break; // ✅ 使用 break 而不是 return,确保迭代器被正常消费
                                } catch (err) {
                                    console.error('Auto-save reply failed:', err);
                                    saveError = err as Error;
                                    break; // ✅ 使用 break 而不是 return
                                }
                            } else {
                                // 手动触发：存到临时状态，等用户确认保存
                                setTempAiReply([parsed[0], parsed[1]]);
                            }
                        }
                    } catch (e) {
                        console.log('[AI Reply] Parse attempt failed:', e);
                    }
                }
            }

            // 在循环外返回结果
            if (autoSave) {
                if (saveError) return false;
                return saveSuccess;
            }
            return true;
        } catch (e) {
            console.error('AI Reply Error:', e);
            setAiError((e as Error).message);
            return false;
        } finally {
            console.log(`[ServerTicketDetail] handleTriggerAiReply FINALLY for #${currentTicket.id}`);
            setActiveReplyingId(null); // 清理互斥状态
            setProcessStatus(currentTicket.id, null);
            onProcessStatusChange?.(currentTicket.id, null);
        }
    }, [ticket, parsedData, generatingAiReply, isProcessing, notebookConfig, onRefresh, onProcessStatusChange, getActiveReplyingId, setActiveReplyingId, setTempAiReply]);

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
            // Optimistic update or refresh
            onProcessStatusChange?.(ticket.id, 'translating');
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
            // Optimistic update or refresh
            onProcessStatusChange?.(ticket.id, 'replying');
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
                <div className="flex-none p-2 bg-emerald-600/20 border-b border-emerald-500/30 flex items-center justify-between animate-in slide-in-from-top duration-300">
                    <div className="flex items-center gap-2 px-2">
                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Translation Preview (Click Confirm to Save)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setGlobalTempTranslation(ticket.id, null)} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-[10px] font-bold">
                            CANCEL
                        </button>
                        <button onClick={handleConfirmTranslation} disabled={submitting} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-[10px] font-bold shadow-lg shadow-emerald-500/20">
                            {submitting ? 'SAVING...' : 'CONFIRM & SAVE'}
                        </button>
                    </div>
                </div>
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
                        {(generatingAiReply || aiReplyText || (ticket.replies && ticket.replies.length > 0)) && (
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

                                {(generatingAiReply || aiReplyText || aiError) && (
                                    <div className="relative mt-2 group">
                                        {/* 装饰边框背景 */}
                                        <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500/20 via-indigo-500/20 to-pink-500/20 rounded-2xl blur opacity-30 group-hover:opacity-100 transition duration-1000"></div>

                                        <div className={`relative rounded-xl overflow-hidden border shadow-2xl transition-all duration-500 ${aiError
                                            ? 'bg-slate-900/90 border-red-500/40'
                                            : 'bg-slate-900/90 border-purple-500/30'
                                            }`}>

                                            {/* AI Header */}
                                            <div className="flex items-center justify-between px-4 py-3 bg-white/5 border-b border-white/5">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs ${aiError
                                                        ? 'bg-red-500/20 text-red-400'
                                                        : 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-500/20'
                                                        }`}>
                                                        {aiError ? '!' : 'AI'}
                                                    </div>
                                                    <span className="text-[11px] font-black text-white uppercase tracking-wider">
                                                        {aiError ? 'Generation Error' : 'NotebookLM Response'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {!aiError && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setShowPrompts(!showPrompts);
                                                            }}
                                                            className={`px-3 py-1 text-[9px] font-black rounded-lg border transition-all ${showPrompts ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:border-white/20'}`}
                                                        >
                                                            {showPrompts ? 'HIDE PROMPTS' : 'VIEW PROMPTS'}
                                                        </button>
                                                    )}
                                                    <div className="flex items-center gap-2">
                                                        {aiReplies && !aiError && !generatingAiReply && (
                                                            <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/10 mr-2">
                                                                <button
                                                                    onClick={() => setAiReplyLang('original')}
                                                                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${aiReplyLang === 'original' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                                                                >
                                                                    ORIGIN
                                                                </button>
                                                                <button
                                                                    onClick={() => setAiReplyLang('cn')}
                                                                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${aiReplyLang === 'cn' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                                                                >
                                                                    CHINESE
                                                                </button>
                                                            </div>
                                                        )}
                                                        <button onClick={() => { setAiReplyText(''); setAiError(null); onProcessStatusChange?.(ticket.id, null); }} className="text-slate-500 hover:text-white transition-colors">
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* AI Content Area */}
                                            <div className="p-6 overflow-hidden">
                                                {showPrompts ? (
                                                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                        <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                                                            RAW PROMPT DEBUGGER
                                                        </div>
                                                        <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
                                                            <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap leading-relaxed selection:bg-indigo-500/30">
                                                                {currentPrompt || 'Prompt processing...'}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className={`min-h-[100px] text-sm leading-relaxed whitespace-pre-wrap transition-all ${aiError ? 'text-red-400 font-mono' : 'text-slate-200'}`}>
                                                        {aiError ? (
                                                            <div className="flex items-start gap-2">
                                                                <span className="mt-1">❌</span>
                                                                <span>{aiError}</span>
                                                            </div>
                                                        ) : aiReplies ? (
                                                            <div className="animate-in fade-in duration-500">
                                                                {isSplitMode ? (
                                                                    <div className="grid grid-cols-2 gap-4">
                                                                        <div className="bg-slate-800/60 p-4 rounded-lg border border-slate-700/50">
                                                                            <div className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Target Language Reply</div>
                                                                            <div className="text-sm text-slate-200 whitespace-pre-wrap">{aiReplies[0]}</div>
                                                                        </div>
                                                                        <div className="bg-emerald-900/40 p-4 rounded-lg border border-emerald-700/50">
                                                                            <div className="text-[10px] font-bold text-emerald-500 mb-2 uppercase tracking-wider">中文回复</div>
                                                                            <div className="text-sm text-emerald-100 whitespace-pre-wrap">{aiReplies[1]}</div>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="space-y-4">
                                                                        <div className="bg-slate-800/60 p-4 rounded-lg border border-slate-700/50">
                                                                            <div className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Target Language Reply</div>
                                                                            <div className="text-sm text-slate-200 whitespace-pre-wrap">{aiReplies[0]}</div>
                                                                        </div>
                                                                        <div className="bg-emerald-900/40 p-4 rounded-lg border border-emerald-700/50">
                                                                            <div className="text-[10px] font-bold text-emerald-500 mb-2 uppercase tracking-wider">中文回复</div>
                                                                            <div className="text-sm text-emerald-100 whitespace-pre-wrap">{aiReplies[1]}</div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : aiReplyText ? (
                                                            <div className="flex flex-col">
                                                                {aiReplyText}
                                                                {generatingAiReply && <span className="inline-block w-1 h-4 ml-1 bg-purple-500 animate-pulse align-middle"></span>}
                                                            </div>
                                                        ) : (
                                                            <div className="flex flex-col items-center justify-center py-6 gap-3">
                                                                <div className="flex gap-1.5 item-center">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:-0.3s]"></div>
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:-0.15s]"></div>
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce"></div>
                                                                </div>
                                                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest animate-pulse">Analyzing context & building response...</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                <div ref={aiResponseEndRef} />
                                            </div>

                                            {/* AI Actions / Save & Discard */}
                                            {aiReplies && !aiError && !generatingAiReply && (
                                                <div className="bg-gradient-to-r from-purple-600/10 to-indigo-600/10 border-t border-purple-500/20 p-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            {tempAiReply ? (
                                                                <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-2">
                                                                    <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></span>
                                                                    等待保存确认
                                                                </span>
                                                            ) : (
                                                                <span className="text-[10px] font-bold text-slate-500">
                                                                    已完成 · 请复制或保存回复
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => {
                                                                    const text = aiReplies ? `${aiReplies[0]}\n\n---\n\n${aiReplies[1]}` : aiReplyText;
                                                                    navigator.clipboard.writeText(text);
                                                                    alert('已复制到剪贴板');
                                                                }}
                                                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-[10px] font-black border border-white/10 flex items-center gap-1.5 transition-all"
                                                            >
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                                                                复制全部
                                                            </button>
                                                            <button
                                                                onClick={() => { setTempAiReply(null); setAiReplies(null); setAiReplyText(''); }}
                                                                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md text-[10px] font-black border border-white/10 transition-all"
                                                            >
                                                                丢弃
                                                            </button>
                                                            {tempAiReply && (
                                                                <button
                                                                    onClick={handleConfirmReply}
                                                                    disabled={submitting}
                                                                    className="px-5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-md text-[10px] font-black shadow-lg shadow-purple-500/30 transition-all flex items-center gap-2 animate-pulse"
                                                                >
                                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                                    {submitting ? '保存中...' : '保存回复'}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* 历史回复部分 */}
                                {ticket.replies && ticket.replies.length > 0 && (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 pt-6 pb-2">
                                            <div className="w-1.5 h-3 bg-slate-600 rounded-full"></div>
                                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">History Logs</h4>
                                        </div>
                                        {ticket.replies.map(reply => (
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
                                                {ticket.status === 'PENDING_AUDIT' && (
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
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
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
