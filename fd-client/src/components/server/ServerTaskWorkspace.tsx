import React, { useState, useEffect, useCallback, useRef } from 'react';
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
    isProcessed?: boolean;
}

interface ServerTaskWorkspaceProps {
    type: 'translation' | 'reply' | 'audit';
    translatingTasks: Task[];
    completedTasks: Task[];
    selectedTaskId?: number | null;
    onSelectTask?: (id: number | null) => void;
    onLoadTicket: (ticketId: number) => Promise<ServerTicket>;
    onRefresh?: () => void;
}

const ServerTaskWorkspace: React.FC<ServerTaskWorkspaceProps> = ({
    type,
    translatingTasks,
    completedTasks,
    selectedTaskId: propSelectedTaskId,
    onSelectTask,
    onLoadTicket,
    onRefresh
}) => {
    const [internalSelectedTicketId, setInternalSelectedTicketId] = useState<number | null>(null);
    const selectedTicketId = propSelectedTaskId !== undefined ? propSelectedTaskId : internalSelectedTicketId;

    // 已完成任务打开的 Tab 列表（独立于处理中 Tab）
    const [openedCompletedTabs, setOpenedCompletedTabs] = useState<Task[]>([]);

    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const { getProcessState, setProcessStatus } = useTicketProcess();

    const setProcessingStatus = useCallback((ticketId: number, status: 'translating' | 'replying' | null) => {
        setProcessStatus(ticketId, status);
    }, [setProcessStatus]);

    const currentGlobalActiveStatus = React.useMemo(() => {
        if (!selectedTicketId) return null;
        return getProcessState(Number(selectedTicketId)).status;
    }, [selectedTicketId, getProcessState]);

    const [isSplitMode, setIsSplitModeState] = useState<boolean>(() => {
        const saved = localStorage.getItem('server_split_mode');
        return saved !== null ? saved === 'true' : true;
    });

    const setIsSplitMode = (s: boolean) => {
        setIsSplitModeState(s);
        localStorage.setItem('server_split_mode', s.toString());
    };

    const detailRef = useRef<any>(null);

    const fetchTicketData = useCallback(async (id: number) => {
        if (!id || id <= 0) return;
        setIsLoading(true);
        try {
            const ticket = await onLoadTicket(id);
            setSelectedTicket(ticket);
        } catch (err) {
            console.error('Failed to load task ticket:', err);
        } finally {
            setIsLoading(false);
        }
    }, [onLoadTicket]);

    // 判断一个 ticketId 是否正在处理中
    const isTaskProcessing = useCallback((ticketId: number) => {
        return translatingTasks.some(t => t.ticketId === ticketId);
    }, [translatingTasks]);

    // 当任务从 "已完成Tab" 中被触发了 AI REPLY/TRANSLATE，它会进入 translatingTasks
    // 此时需要从 openedCompletedTabs 中移除（避免重复展示）
    useEffect(() => {
        setOpenedCompletedTabs(prev =>
            prev.filter(tab => !translatingTasks.some(t => t.ticketId === tab.ticketId))
        );
    }, [translatingTasks]);

    // 外部选中（来自左侧面板）：将已完成任务加入 openedCompletedTabs
    useEffect(() => {
        if (propSelectedTaskId && !isTaskProcessing(propSelectedTaskId)) {
            const completedTask = completedTasks.find(t => t.ticketId === propSelectedTaskId);
            if (completedTask) {
                setOpenedCompletedTabs(prev => {
                    if (prev.some(t => t.ticketId === propSelectedTaskId)) return prev;
                    return [...prev, completedTask];
                });
            }
        }
    }, [propSelectedTaskId, completedTasks, isTaskProcessing]);

    // 追踪 translatingTasks 变化：新任务自动选中，任务完成后自动处理 Tab
    const prevTranslatingIdsRef = useRef(new Set<number>(translatingTasks.map(t => t.ticketId)));
    useEffect(() => {
        const currentIds = new Set(translatingTasks.map(t => t.ticketId));
        const prevIds = prevTranslatingIdsRef.current;
        prevTranslatingIdsRef.current = currentIds;

        // 检测新增的任务（进入处理队列）
        const newIds = [...currentIds].filter(id => !prevIds.has(id));
        if (newIds.length > 0) {
            // 新任务进入处理队列，自动切换到第一个
            handleSelectTask(translatingTasks[0].ticketId);
            return;
        }

        // 检测离开的任务（处理完成）
        const removedIds = [...prevIds].filter(id => !currentIds.has(id));
        for (const removedId of removedIds) {
            const completedTask = completedTasks.find(t => t.ticketId === removedId);
            if (completedTask && completedTask.success === false) {
                // 失败任务：自动保留在选项卡中
                setOpenedCompletedTabs(prev => {
                    if (prev.some(t => t.ticketId === removedId)) return prev;
                    return [...prev, completedTask];
                });
            } else {
                // 成功任务：不保留选项卡，如果当前选中的就是它则切走
                if (selectedTicketId === removedId) {
                    const nextId = translatingTasks.length > 0 ? translatingTasks[0].ticketId : null;
                    if (onSelectTask) onSelectTask(nextId);
                    else setInternalSelectedTicketId(nextId);
                }
            }
        }

        // 当前无选中任务时，选中执行中的第一个
        if (translatingTasks.length > 0 && !selectedTicketId) {
            handleSelectTask(translatingTasks[0].ticketId);
        }
    }, [translatingTasks, completedTasks, selectedTicketId]);

    const handleSelectTask = (id: number | null) => {
        if (id === selectedTicketId && selectedTicket) return;

        if (onSelectTask) {
            onSelectTask(id);
        } else {
            setInternalSelectedTicketId(id);
        }

        // 如果点的是已完成任务，将其加入 openedCompletedTabs（如果不在处理中列表中）
        if (id && !isTaskProcessing(id)) {
            const completedTask = completedTasks.find(t => t.ticketId === id);
            if (completedTask) {
                setOpenedCompletedTabs(prev => {
                    if (prev.some(t => t.ticketId === id)) return prev;
                    return [...prev, completedTask];
                });
            }
        }
    };

    const handleCloseCompletedTab = (ticketId: number) => {
        setOpenedCompletedTabs(prev => prev.filter(t => t.ticketId !== ticketId));
        // 如果关闭的是当前选中的 Tab，选中处理中的第一个或 null
        if (selectedTicketId === ticketId) {
            const nextId = translatingTasks.length > 0 ? translatingTasks[0].ticketId : null;
            if (onSelectTask) {
                onSelectTask(nextId);
            } else {
                setInternalSelectedTicketId(nextId);
            }
        }
    };

    const handleDetailRefresh = useCallback(async () => {
        if (!selectedTicketId) return;
        await fetchTicketData(selectedTicketId);
        if (onRefresh) onRefresh();
    }, [selectedTicketId, fetchTicketData, onRefresh]);

    useEffect(() => {
        if (selectedTicketId && selectedTicketId > 0) {
            fetchTicketData(selectedTicketId);
        } else {
            setSelectedTicket(null);
        }
    }, [selectedTicketId, fetchTicketData]);

    const typeColor = type === 'translation' ? 'cyan' : type === 'reply' ? 'orange' : 'pink';

    return (
        <div className="flex-1 flex flex-col min-w-0 bg-slate-900/40 relative">
            {/* Tab Bar */}
            <div className="flex items-center gap-1 px-4 pt-3 bg-black/20 border-b border-white/5 overflow-x-auto no-scrollbar">
                {/* 1. 执行中任务标签：不可关闭 */}
                {translatingTasks.map((task) => (
                    <div
                        key={`active-${task.ticketId}`}
                        onClick={() => handleSelectTask(task.ticketId)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-t-xl transition-all cursor-pointer group whitespace-nowrap border-x border-t relative ${selectedTicketId === task.ticketId
                            ? 'bg-slate-800 text-white border-white/10 translate-y-[1px] z-10 shadow-[0_-4px_12px_rgba(0,0,0,0.5)]'
                            : 'text-slate-500 hover:text-slate-300 border-transparent hover:bg-white/5'
                            }`}
                    >
                        <div className={`w-1.5 h-1.5 rounded-full animate-pulse bg-${typeColor}-400`} />
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

                {/* 2. 已完成任务标签：可关闭 */}
                {openedCompletedTabs.map((task) => (
                    <div
                        key={`completed-${task.ticketId}`}
                        onClick={() => handleSelectTask(task.ticketId)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-t-xl transition-all cursor-pointer group whitespace-nowrap border-x border-t relative ${selectedTicketId === task.ticketId
                            ? 'bg-slate-800 text-white border-white/10 translate-y-[1px] z-10 shadow-[0_-4px_12px_rgba(0,0,0,0.5)]'
                            : 'text-slate-500 hover:text-slate-300 border-transparent hover:bg-white/5'
                            }`}
                    >
                        <div className={`w-1.5 h-1.5 rounded-full ${task.success === false ? 'bg-red-500' : 'bg-green-500'}`} />
                        <span className="text-xs font-bold font-mono tracking-tight">#{task.externalId}</span>
                        <span className="text-[10px] opacity-40 group-hover:opacity-100 max-w-[80px] truncate leading-none">
                            {task.subject}
                        </span>
                        {/* Close button */}
                        <button
                            onClick={(e) => { e.stopPropagation(); handleCloseCompletedTab(task.ticketId); }}
                            className="ml-1 w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-slate-500 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                        >
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        {selectedTicketId === task.ticketId && (
                            <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${task.success === false ? 'bg-red-500' : 'bg-green-500'}`} />
                        )}
                    </div>
                ))}

                {translatingTasks.length === 0 && openedCompletedTabs.length === 0 && (
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
                        isProcessing={isTaskProcessing(selectedTicket.id)}
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
