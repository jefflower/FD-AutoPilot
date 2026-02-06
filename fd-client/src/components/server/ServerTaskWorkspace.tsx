import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ServerTicket } from '../../types/server';
import ServerTicketDetail from './ServerTicketDetail';
import { useTicketProcess } from '../../hooks/useTicketProcess';

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
    // 处理持久化状态：改用全局 Hook
    const { getProcessState, setProcessStatus } = useTicketProcess();

    const setProcessingStatus = useCallback((ticketId: number, status: 'translating' | 'replying' | null) => {
        console.log(`[Workspace Audit] Ticket #${ticketId} status change: ${status}`);
        setProcessStatus(ticketId, status);
    }, [setProcessStatus]);


    // === 核心状态:计算当前选中工单的全局活跃状态 (手动触发 + MQ 自动触发) ===
    const currentGlobalActiveStatus = React.useMemo(() => {
        if (!selectedTicketId) return null;
        const idNum = Number(selectedTicketId);

        // 直接使用 useTicketProcess 的状态,它已经正确管理了 translating 和 replying 状态
        const status = getProcessState(idNum).status;

        console.log(`[Workspace Status Tracking] ID: ${idNum}, Status: ${status}`);

        return status;
    }, [selectedTicketId, getProcessState]);


    const [isSplitMode, setIsSplitModeState] = useState<boolean>(() => {
        const saved = localStorage.getItem('server_split_mode');
        return saved !== null ? saved === 'true' : true; // 默认开启分栏
    });


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
    const processingMqId = useRef<number | null>(null);

    useEffect(() => {
        if (mqTarget) {
            const { id, type: taskType } = mqTarget;

            // 防止重复处理同一个 ID (即便 Effect 因其他依赖刷新)
            if (processingMqId.current === id) {
                console.log(`[Workspace MQ] Skipping redundant effect for ticket #${id}`);
                return;
            }

            processingMqId.current = id;
            console.log(`[Workspace MQ] Handling ${taskType} for ticket #${id}`);

            // 1. 选中该工单 (触发详情页加载)
            handleSelectTask(id);

            // 2. 开始轮询执行
            let retryCount = 0;
            const maxRetries = 200; // 增加到 20秒 容错
            let isCurrentEffectActive = true;

            const checkAndRun = async () => {
                if (!isCurrentEffectActive) return;

                const currentId = detailRef.current?.getTicketId();
                // 检查：引用存在 && ID 匹配
                if (detailRef.current && currentId === id) {
                    console.log(`[Workspace MQ] Ready. ID matched: ${currentId}. Triggering...`);
                    let success = false;
                    try {
                        if (taskType === 'translate' && detailRef.current.handleAiTranslate) {
                            console.log(`[Workspace MQ] 🚀 Starting AI Translation for ticket #${id}...`);
                            success = await detailRef.current.handleAiTranslate(true);
                            console.log(`[Workspace MQ] ✅ AI Translation completed for ticket #${id}, success: ${success}`);
                            await invoke('complete_translate_task', { ticketId: id, success });
                            console.log(`[Workspace MQ] 📡 Sent ACK signal to Rust backend for ticket #${id}`);
                        } else if (taskType === 'reply' && detailRef.current.handleTriggerAiReply) {
                            console.log(`[Workspace MQ] 🚀 Starting AI Reply for ticket #${id}...`);
                            const startTime = Date.now();
                            success = await detailRef.current.handleTriggerAiReply(true);
                            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                            console.log(`[Workspace MQ] ✅ AI Reply completed for ticket #${id}, success: ${success}, duration: ${duration}s`);
                            await invoke('complete_reply_task', { ticketId: id, success });
                            console.log(`[Workspace MQ] 📡 Sent ACK signal to Rust backend for ticket #${id}`);
                        } else {
                            console.warn(`[Workspace MQ] Method for ${taskType} not found in detailRef`);
                            await invoke(taskType === 'translate' ? 'complete_translate_task' : 'complete_reply_task', { ticketId: id, success: false });
                        }
                    } catch (err) {
                        console.error(`[Workspace MQ] Critical error:`, err);
                        await invoke(taskType === 'translate' ? 'complete_translate_task' : 'complete_reply_task', { ticketId: id, success: false });
                    } finally {
                        if (isCurrentEffectActive) {
                            onMqTargetHandled?.();
                            processingMqId.current = null; // 重置，允许下次处理同名 ID（虽不太可能）
                            // 触发一次数据刷新
                            fetchTicketData(id);
                            if (onRefresh) onRefresh();
                        }
                    }
                } else if (retryCount < maxRetries) {
                    retryCount++;
                    if (isCurrentEffectActive) {
                        setTimeout(checkAndRun, 100);
                    }
                } else {
                    console.error(`[Workspace MQ] Timeout after ${maxRetries} retries. Ready: ${!!detailRef.current}, ID in Detail: ${currentId}, Target ID: ${id}`);
                    if (isCurrentEffectActive) {
                        const cmd = taskType === 'translate' ? 'complete_translate_task' : 'complete_reply_task';
                        await invoke(cmd, { ticketId: id, success: false });
                        onMqTargetHandled?.();
                        processingMqId.current = null;
                        if (onRefresh) onRefresh();
                    }
                }
            };

            checkAndRun();
            return () => {
                isCurrentEffectActive = false;
                if (processingMqId.current === id) processingMqId.current = null; // 清理
            };
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

    // 包装详情页的刷新逻辑：既刷新列表状态，也重新拉取当前详情
    const handleDetailRefresh = useCallback(async () => {
        if (!selectedTicketId) return;

        console.log('[Workspace] Refreshing ticket data:', selectedTicketId);

        // 直接重新获取最新数据并载入
        await fetchTicketData(selectedTicketId);

        if (onRefresh) {
            onRefresh();
        }
    }, [selectedTicketId, fetchTicketData, onRefresh]);

    // 监听选中 ID 变化并加载数据
    useEffect(() => {
        if (selectedTicketId && selectedTicketId > 0) {
            fetchTicketData(selectedTicketId);
        } else {
            setSelectedTicket(null);
        }
    }, [selectedTicketId, fetchTicketData]);

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

                {translatingTasks.length === 0 && (
                    <div className="flex items-center px-4 text-slate-600 text-[10px] italic h-10">
                        {type === 'translation' ? 'Waiting for MQ tasks...' : 'No active tasks'}
                    </div>
                )}
            </div>

            {/* Detail Area */}
            <div className="flex-1 relative overflow-hidden bg-slate-900">
                {isLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/10 backdrop-blur-sm z-10">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                ) : null}

                {selectedTicket ? (
                    <ServerTicketDetail
                        key={selectedTicket.id}
                        ref={detailRef}
                        ticket={selectedTicket}
                        isEmbed={true}
                        isProcessing={translatingTasks.some(t => Number(t.ticketId) === Number(selectedTicket.id))}
                        activeProcessType={currentGlobalActiveStatus}
                        onProcessStatusChange={setProcessingStatus}
                        isSplitMode={isSplitMode}
                        setIsSplitMode={setIsSplitMode}
                        onRefresh={handleDetailRefresh}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-600 flex-col gap-4 h-full">
                        <svg className="w-16 h-16 opacity-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 6h16M4 12h16m-7 6h7" />
                        </svg>
                        <p className="text-sm font-medium">Please select a task from the list</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ServerTaskWorkspace;
