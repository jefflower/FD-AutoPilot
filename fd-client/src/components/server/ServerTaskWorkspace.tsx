import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ServerTicket } from '../../types/server';
import ServerTicketDetail from './ServerTicketDetail';

interface Task {
    ticketId: number;
    externalId: string;
    subject: string;
    startedAt: number;
    completedAt?: number;
    success?: boolean;
    isProcessed?: boolean; // 是否已经点开过
}

interface ServerTaskWorkspaceProps {
    type: 'translation' | 'reply' | 'audit';
    translatingTasks: Task[];
    completedTasks: Task[];
    selectedTaskId?: number | null; // 新增：外部控制选中的任务
    onSelectTask?: (id: number | null) => void; // 新增：选中任务时的回调
    onLoadTicket: (ticketId: number) => Promise<ServerTicket>;
    onRefresh?: () => void;
    mqTarget?: { id: number; type: 'translate' | 'reply' } | null;
    onMqTargetHandled?: () => void;
}

const ServerTaskWorkspace: React.FC<ServerTaskWorkspaceProps> = ({
    type,
    translatingTasks,
    completedTasks,
    selectedTaskId: propSelectedTaskId,
    onSelectTask,
    onLoadTicket,
    onRefresh,
    mqTarget,
    onMqTargetHandled
}) => {
    // 状态：当前手动点开的“已完成”工单 ID（只能同时打开一个）
    const [viewingCompletedId, setViewingCompletedId] = useState<number | null>(null);
    const [internalSelectedTicketId, setInternalSelectedTicketId] = useState<number | null>(null);
    const selectedTicketId = propSelectedTaskId !== undefined ? propSelectedTaskId : internalSelectedTicketId;

    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // MQ 专用状态：用于后台执行的任务工单数据
    const [mqTicket, setMqTicket] = useState<ServerTicket | null>(null);
    const mqDetailRef = useRef<any>(null);

    // 监听 mqTarget 变化并加载对应的工单数据（用于后台执行）
    useEffect(() => {
        if (mqTarget && mqTarget.id) {
            // 如果 mqTarget 和当前选中的是同一个，可以直接复用（优化点），但为了逻辑简单，这里独立加载
            // 或者：如果 ID 相同，且 selectedTicket 已经有了，是否可以复用？
            // 考虑到 selectedTicket 可能还没加载完，这里还是独立加载比较稳妥，或者依赖 caching
            console.log(`[Workspace] Loading MQ ticket #${mqTarget.id}...`);
            onLoadTicket(mqTarget.id)
                .then(t => setMqTicket(t))
                .catch(err => console.error('Failed to load MQ ticket:', err));
        } else {
            setMqTicket(null);
        }
    }, [mqTarget, onLoadTicket]);

    // 语言与显示偏好 (从 localStorage 加载以保持跨页面一致性)
    const [displayLang, setDisplayLangState] = useState<'original' | 'cn' | 'en'>(() => {
        return (localStorage.getItem('server_display_lang') as 'original' | 'cn' | 'en') || 'cn';
    });
    const [isSplitMode, setIsSplitModeState] = useState<boolean>(() => {
        const saved = localStorage.getItem('server_split_mode');
        return saved !== null ? saved === 'true' : true; // 默认开启分栏
    });

    const setDisplayLang = (l: 'original' | 'cn' | 'en') => {
        setDisplayLangState(l);
        localStorage.setItem('server_display_lang', l);
    };

    const setIsSplitMode = (s: boolean) => {
        setIsSplitModeState(s);
        localStorage.setItem('server_split_mode', s.toString());
    };

    // 详情页引用
    const detailRef = useRef<any>(null);

    // 提取为一个稳定的加载函数
    const fetchTicketData = useCallback(async (id: number) => {
        if (!id || id <= 0) return;
        setIsLoading(true);
        try {
            console.log(`[Workspace] Loading ticket #${id}...`);
            const ticket = await onLoadTicket(id);
            setSelectedTicket(ticket);
        } catch (err) {
            console.error('Failed to load task ticket:', err);
        } finally {
            setIsLoading(false);
        }
    }, [onLoadTicket]);

    // MQ 事件处理: 响应来自父组件的调度信号 (自动处理本工作区内的任务)
    useEffect(() => {
        if (mqTarget) {
            const { id, type: taskType } = mqTarget;
            console.log(`[Workspace MQ] Handling ${taskType} for ticket #${id}`);

            // 1. 选中该工单 (触发详情页加载)
            // 初始时跳转到该任务，以满足 "显示正在执行任务" 的需求，但允许用户随后切换到其他 tab
            handleSelectTask(id);

            // 2. 开始轮询执行
            let retryCount = 0;
            const maxRetries = 200; // 增加到 20秒 容错
            let isCurrentEffectActive = true;

            const checkAndRun = async () => {
                if (!isCurrentEffectActive) return;

                // 使用 mqDetailRef 确保即使切换了 Tab，后台任务也能引用到正确的组件实例
                const currentRef = mqDetailRef.current;
                const currentId = currentRef?.getTicketId();

                // 检查：引用存在 && ID 匹配
                if (currentRef && currentId === id) {
                    console.log(`[Workspace MQ] Ready. ID matched: ${currentId}. Triggering...`);
                    let success = false;
                    try {
                        if (taskType === 'translate' && currentRef.handleAiTranslate) {
                            success = await currentRef.handleAiTranslate(true);
                            await invoke('complete_translate_task', { ticketId: id, success });
                        } else if (taskType === 'reply' && currentRef.handleTriggerAiReply) {
                            success = await currentRef.handleTriggerAiReply(true);
                            await invoke('complete_reply_task', { ticketId: id, success });
                        } else {
                            console.warn(`[Workspace MQ] Method for ${taskType} not found in mqDetailRef`);
                            // 降级上报，避免死锁
                            const cmd = taskType === 'translate' ? 'complete_translate_task' : 'complete_reply_task';
                            await invoke(cmd, { ticketId: id, success: false });
                        }
                    } catch (err) {
                        console.error(`[Workspace MQ] Critical error:`, err);
                        const cmd = taskType === 'translate' ? 'complete_translate_task' : 'complete_reply_task';
                        await invoke(cmd, { ticketId: id, success: false });
                    } finally {
                        if (isCurrentEffectActive) {
                            onMqTargetHandled?.();
                            // 注意：不要调用 fetchTicketData(id)，因为它会强制选中该 Ticket，干扰用户查看其他 Ticket
                            // mqTicket 的数据刷新已在组件 onRefresh prop 中处理
                            onRefresh?.();
                        }
                    }
                } else if (retryCount < maxRetries) {
                    retryCount++;
                    if (isCurrentEffectActive) {
                        setTimeout(checkAndRun, 100);
                    }
                } else {
                    console.error(`[Workspace MQ] Timeout after ${maxRetries} retries. Ready: ${!!currentRef}, ID in Detail: ${currentId}, Target ID: ${id}`);
                    if (isCurrentEffectActive) {
                        const cmd = taskType === 'translate' ? 'complete_translate_task' : 'complete_reply_task';
                        await invoke(cmd, { ticketId: id, success: false });
                        onMqTargetHandled?.();
                        onRefresh?.();
                    }
                }
            };

            checkAndRun();
            return () => { isCurrentEffectActive = false; };
        }
    }, [mqTarget, onMqTargetHandled, onRefresh, fetchTicketData]);


    // 1. 响应逻辑：
    // 如果外部传入或选中的是一个正在处理的任务 -> 属于“执行中”标签
    // 如果外部传入或选中的是一个已完成的任务 -> 设置为 viewingCompletedId
    useEffect(() => {
        if (propSelectedTaskId) {
            const isComp = completedTasks.some(t => t.ticketId === propSelectedTaskId);
            if (isComp) {
                setViewingCompletedId(propSelectedTaskId);
            }
        }
    }, [propSelectedTaskId, completedTasks.length]);

    // 2. 自动追踪：新任务开始处理时，自动选中它
    useEffect(() => {
        if (translatingTasks.length > 0) {
            const latest = translatingTasks[0].ticketId;
            // 只有当当前没选中，或者当前选中的不是正在处理的任务时，才自动跳转
            const isCurrentProcessing = translatingTasks.some(t => t.ticketId === selectedTicketId);
            if (!selectedTicketId || !isCurrentProcessing) {
                handleSelectTask(latest);
            }
        }
    }, [translatingTasks.length, selectedTicketId]); // 依赖 selectedTicketId 确保在选中状态变化时重新评估

    // 内部处理选中 (已经声明在上方)
    const handleSelectTask = (id: number | null) => {
        if (id === selectedTicketId && selectedTicket) return;

        if (onSelectTask) {
            onSelectTask(id);
        } else {
            setInternalSelectedTicketId(id);
        }

        // 如果点的是已完成列表，同步到 viewingCompletedId
        if (id && completedTasks.some(t => t.ticketId === id)) {
            setViewingCompletedId(id);
        } else if (id && translatingTasks.some(t => t.ticketId === id)) {
            setViewingCompletedId(null); // 如果选中了处理中的任务，则关闭已完成任务的显示
        }
    };

    // 关闭“已完成”标签页逻辑
    const handleCloseCompletedTab = (e: React.MouseEvent) => {
        e.stopPropagation();
        setViewingCompletedId(null);

        // 如果当前正好选中的是这个已完成标签，切换到第一个正在处理的任务
        if (viewingCompletedId === selectedTicketId) {
            if (translatingTasks.length > 0) {
                handleSelectTask(translatingTasks[0].ticketId);
            } else {
                if (onSelectTask) onSelectTask(null as any);
                setInternalSelectedTicketId(null);
            }
        }
    };

    // 监听选中 ID 变化并加载数据
    useEffect(() => {
        if (selectedTicketId && selectedTicketId > 0) {
            fetchTicketData(selectedTicketId);
        } else {
            setSelectedTicket(null);
        }
    }, [selectedTicketId, fetchTicketData]);

    const isProcessing = (id: number) => translatingTasks.some(t => t.ticketId === id);

    // 获取“已完成”标签页的任务对象
    const viewingCompletedTask = viewingCompletedId ? completedTasks.find(t => t.ticketId === viewingCompletedId) : null;

    return (
        <div className="flex-1 flex flex-col min-w-0 bg-slate-900/40 relative">
            {/* Tab Bar */}
            <div className="flex items-center gap-1 px-4 pt-3 bg-black/20 border-b border-white/5 overflow-x-auto no-scrollbar">
                {/* 1. 执行中任务标签：按队列顺序排列，不可关闭 */}
                {translatingTasks.map((task) => (
                    <div
                        key={task.ticketId}
                        onClick={() => handleSelectTask(task.ticketId)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-t-xl transition-all cursor-pointer group whitespace-nowrap border-x border-t relative ${selectedTicketId === task.ticketId
                            ? 'bg-slate-800 text-white border-white/10 translate-y-[1px] z-10 shadow-[0_-4px_12px_rgba(0,0,0,0.5)]'
                            : 'text-slate-500 hover:text-slate-300 border-transparent hover:bg-white/5'
                            }`}
                    >
                        <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${type === 'audit' ? 'bg-pink-500' : 'bg-cyan-400'
                            }`} />
                        <span className="text-xs font-bold font-mono tracking-tight">#{task.externalId}</span>
                        <span className="text-[10px] opacity-40 group-hover:opacity-100 max-w-[100px] truncate leading-none">
                            {task.subject}
                        </span>

                        {selectedTicketId === task.ticketId && (
                            <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${type === 'translation' ? 'bg-cyan-500' :
                                type === 'reply' ? 'bg-orange-500' : 'bg-pink-500'
                                }`} />
                        )}
                    </div>
                ))}

                {/* 分隔线（如果有执行中任务且有查看中的已完成任务） */}
                {translatingTasks.length > 0 && viewingCompletedTask && (
                    <div className="w-px h-6 bg-white/10 mx-2 self-center mb-2" />
                )}

                {/* 2. 已完成任务专用标签：放在最后（右侧），可关闭 */}
                {viewingCompletedTask && (
                    <div
                        onClick={() => handleSelectTask(viewingCompletedTask.ticketId)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-t-xl transition-all cursor-pointer group whitespace-nowrap border-x border-t relative ${selectedTicketId === viewingCompletedTask.ticketId
                            ? 'bg-slate-800 text-white border-white/10 translate-y-[1px] z-10 shadow-[0_-4px_12px_rgba(0,0,0,0.5)]'
                            : 'text-slate-500 hover:text-slate-300 border-transparent hover:bg-white/5'
                            }`}
                    >
                        <div className={`w-1.5 h-1.5 rounded-full ${viewingCompletedTask.success ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="text-xs font-bold font-mono tracking-tight">#{viewingCompletedTask.externalId}</span>
                        <span className="text-[10px] opacity-40 group-hover:opacity-100 max-w-[100px] truncate leading-none">
                            {viewingCompletedTask.subject}
                        </span>

                        <button
                            onClick={handleCloseCompletedTab}
                            className="ml-1 p-0.5 rounded-full hover:bg-white/10 opacity-60 hover:opacity-100 transition-opacity"
                        >
                            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        {selectedTicketId === viewingCompletedTask.ticketId && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
                        )}
                    </div>
                )}

                {translatingTasks.length === 0 && !viewingCompletedTask && (
                    <div className="flex items-center px-4 text-slate-600 text-[10px] italic h-10">
                        等待 MQ 任务中...
                    </div>
                )}
            </div>

            {/* Detail Area */}
            <div className="flex-1 relative overflow-hidden">
                {/* 1. MQ Ticket Detail (Background or Foreground) */}
                {/* 必须存在，以供 automation 调用。如果也是当前选中的，则显示；否则隐藏 */}
                {mqTicket && (
                    <div className={mqTarget && selectedTicketId === mqTarget.id ? "h-full w-full" : "hidden"}>
                        <ServerTicketDetail
                            ref={mqDetailRef}
                            ticket={mqTicket}
                            isEmbed={true}
                            isProcessing={true}
                            displayLang={displayLang}
                            setDisplayLang={setDisplayLang}
                            isSplitMode={isSplitMode}
                            setIsSplitMode={setIsSplitMode}
                            onRefresh={() => {
                                onRefresh?.();
                                // 刷新后台 MQ 任务的数据，确保显示最新状态（如翻译结果）
                                onLoadTicket(mqTicket.id).then(t => setMqTicket(t));
                            }}
                        />
                    </div>
                )}

                {/* 2. Selected Ticket Detail (Foreground) */}
                {/* 只有当选中的工单不是 MQ 工单时，才渲染这个独立的 view 实例 */}
                {isLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/10 backdrop-blur-sm z-10">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                ) : null}

                {selectedTicket && (!mqTarget || selectedTicket.id !== mqTarget.id) ? (
                    <div className="h-full w-full">
                        <ServerTicketDetail
                            ref={detailRef}
                            ticket={selectedTicket}
                            isEmbed={true}
                            isProcessing={isProcessing(selectedTicket.id)}
                            displayLang={displayLang}
                            setDisplayLang={setDisplayLang}
                            isSplitMode={isSplitMode}
                            setIsSplitMode={setIsSplitMode}
                            onRefresh={onRefresh}
                        />
                    </div>
                ) : null}

                {/* Empty State */}
                {!selectedTicket && (!mqTicket || (mqTarget && selectedTicketId !== mqTarget.id)) && !isLoading && (
                    <div className="flex-1 flex items-center justify-center text-slate-600 flex-col gap-4 h-full">
                        <svg className="w-16 h-16 opacity-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 6h16M4 12h16m-7 6h7" />
                        </svg>
                        <p className="text-sm font-medium">暂无选中的任务详情</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ServerTaskWorkspace;
