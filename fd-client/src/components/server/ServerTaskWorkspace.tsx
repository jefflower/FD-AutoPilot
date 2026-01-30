import React, { useState, useEffect } from 'react';
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
    // 状态：当前手动点开的“已完成”工单 ID（只能同时打开一个）
    const [viewingCompletedId, setViewingCompletedId] = useState<number | null>(null);
    const [internalSelectedTicketId, setInternalSelectedTicketId] = useState<number | null>(null);
    const selectedTicketId = propSelectedTaskId !== undefined ? propSelectedTaskId : internalSelectedTicketId;

    const [selectedTicket, setSelectedTicket] = useState<ServerTicket | null>(null);
    const [isLoading, setIsLoading] = useState(false);

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

    // 内部处理选中
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
            const load = async () => {
                setIsLoading(true);
                try {
                    const ticket = await onLoadTicket(selectedTicketId);
                    setSelectedTicket(ticket);
                } catch (err) {
                    console.error('Failed to load task ticket:', err);
                } finally {
                    setIsLoading(false);
                }
            };
            load();
        } else {
            setSelectedTicket(null);
        }
    }, [selectedTicketId, onLoadTicket]);

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
                {isLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/10 backdrop-blur-sm z-10">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                ) : null}

                {selectedTicket ? (
                    <ServerTicketDetail
                        ticket={selectedTicket}
                        isEmbed={true}
                        isProcessing={isProcessing(selectedTicket.id)}
                        displayLang={displayLang}
                        setDisplayLang={setDisplayLang}
                        isSplitMode={isSplitMode}
                        setIsSplitMode={setIsSplitMode}
                        onRefresh={onRefresh}
                    />
                ) : (
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
