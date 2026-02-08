import React, { useState, useEffect, useCallback, useRef } from 'react';
import { serverApi } from '../../services/serverApi';
import ServerTaskWorkspace from './ServerTaskWorkspace';
import { useMQTranslation } from '../../context/MQTranslationContext';

interface TranslationTasksTabProps {
    initialSelectedId?: number | null;
    onNavigated?: () => void;
}

const TranslationTasksTab: React.FC<TranslationTasksTabProps> = ({ initialSelectedId, onNavigated }) => {
    const {
        processingTasks,
        completedHistory,
        isRunning,
        startConsumer,
        stopConsumer,
        batchSize,
        updateBatchSize,
        logs
    } = useMQTranslation();

    const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId ?? null);
    const [localBatchSize, setLocalBatchSize] = useState<string>('5');

    // 处理外部导航（来自 FloatingTaskWidget）
    useEffect(() => {
        if (initialSelectedId) {
            setSelectedId(initialSelectedId);
            onNavigated?.();
        }
    }, [initialSelectedId, onNavigated]);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const batchSizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Sync context batch size to local input when not focused
    useEffect(() => {
        if (!isInputFocused) {
            setLocalBatchSize(batchSize.toString());
        }
    }, [batchSize, isInputFocused]);

    const handleBatchSizeChange = (value: string) => {
        setLocalBatchSize(value);
        if (batchSizeDebounceRef.current) clearTimeout(batchSizeDebounceRef.current);
        batchSizeDebounceRef.current = setTimeout(() => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0 && num <= 100) {
                updateBatchSize(num);
            }
        }, 500);
    };

    const handleLoadTicket = useCallback(async (ticketId: number) => {
        return await serverApi.ticket.getTicketById(ticketId);
    }, []);

    // Convert Map to Array for display
    const processingList = Array.from(processingTasks.values());
    const processingTicketIds = new Set(processingList.map(t => t.ticketId));

    // 过滤 completedHistory：排除正在处理中的 ticketId（防止重试时 key 冲突）
    const filteredCompletedHistory = completedHistory.filter(t => !processingTicketIds.has(t.ticketId));

    // Map to ServerTaskWorkspace Task format
    const workspaceTranslatingTasks = processingList.map(t => ({
        ticketId: t.ticketId,
        externalId: t.externalId,
        subject: t.subject,
        startedAt: t.addedAt,
        isProcessed: false
    }));

    const workspaceCompletedTasks = filteredCompletedHistory.map(t => ({
        ticketId: t.ticketId,
        externalId: t.externalId,
        subject: t.subject,
        startedAt: t.addedAt,
        completedAt: t.addedAt, // Approximation
        success: t.status === 'completed',
        isProcessed: true
    }));

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧控制区 + 正在处理任务 + 已完成任务 */}
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                <div className="p-4 border-b border-white/10 bg-gradient-to-br from-cyan-900/40 to-blue-900/20">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                            <span className="w-1 h-3 bg-cyan-500 rounded-full"></span>
                            MQ 自动翻译
                        </h3>
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${isRunning
                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                            : 'bg-slate-800 text-slate-500 border border-white/5'
                            }`}>
                            {isRunning ? 'Running' : 'Stopped'}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex gap-2">
                            {!isRunning ? (
                                <button
                                    onClick={() => startConsumer()}
                                    className="flex-1 h-9 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-cyan-900/20 transition-all flex items-center justify-center gap-2"
                                >
                                    启动消费
                                </button>
                            ) : (
                                <button
                                    onClick={() => stopConsumer()}
                                    className="flex-1 h-9 bg-red-500/80 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                                >
                                    停止消费
                                </button>
                            )}
                        </div>

                        <div className="flex items-center justify-between px-1">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Concurrency</span>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-500">x</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={localBatchSize}
                                    onFocus={() => setIsInputFocused(true)}
                                    onBlur={() => setIsInputFocused(false)}
                                    onChange={(e) => handleBatchSizeChange(e.target.value)}
                                    className="w-10 h-6 bg-black/40 border border-white/5 rounded text-cyan-400 text-xs text-center font-mono focus:outline-none focus:border-cyan-500/50"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* 任务列表展示联动 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-4">
                    {/* 正在处理列表 */}
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                {processingList.length > 0 && <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping"></span>}
                                Processing
                            </h4>
                            <span className="text-[10px] font-mono text-cyan-500/50">({processingList.length})</span>
                        </div>

                        <div className="space-y-1">
                            {processingList.map(task => (
                                <button
                                    key={task.ticketId}
                                    onClick={() => setSelectedId(task.ticketId)}
                                    className={`w-full text-left p-2.5 rounded-lg transition-all border group relative ${selectedId === task.ticketId
                                        ? 'bg-cyan-500/10 border-cyan-500/30 shadow-lg shadow-cyan-500/5 z-10'
                                        : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/5'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[11px] font-bold font-mono text-cyan-400 opacity-80 group-hover:opacity-100 transition-opacity">#{task.externalId}</span>
                                        <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse"></div>
                                    </div>
                                    <div className="text-[11px] text-slate-300 truncate font-medium group-hover:text-white transition-colors">{task.subject}</div>

                                    {selectedId === task.ticketId && (
                                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-cyan-500 rounded-l-lg"></div>
                                    )}
                                </button>
                            ))}

                            {processingList.length === 0 && (
                                <div className="text-center py-6 text-slate-600 text-[10px] italic border border-dashed border-white/5 rounded-xl">空闲中...</div>
                            )}
                        </div>
                    </div>

                    {/* 已完成列表 */}
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2 mt-4">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Completed History</h4>
                            <span className="text-[10px] font-mono text-green-500/50">({filteredCompletedHistory.length})</span>
                        </div>
                        <div className="space-y-1">
                            {filteredCompletedHistory.map(task => (
                                <button
                                    key={task.ticketId}
                                    onClick={() => setSelectedId(task.ticketId)}
                                    className={`w-full text-left p-2 rounded-lg transition-all border group ${selectedId === task.ticketId
                                        ? 'bg-green-500/10 border-green-500/30'
                                        : 'bg-white/5 border-transparent hover:bg-white/10'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[10px] font-bold text-slate-500 opacity-60 group-hover:opacity-100 transition-opacity">#{task.externalId}</span>
                                        <span className={`text-[9px] font-black uppercase tracking-tighter ${task.status === 'completed' ? 'text-green-500/50' : 'text-red-500/50'}`}>
                                            {task.status === 'completed' ? 'Done' : 'Failed'}
                                        </span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 truncate group-hover:text-slate-200 transition-colors">{task.subject}</div>
                                </button>
                            ))}
                            {filteredCompletedHistory.length === 0 && (
                                <div className="text-center py-6 text-slate-600 text-[10px] italic border border-dashed border-white/5 rounded-xl">暂无已完成工单</div>
                            )}
                        </div>
                    </div>
                </div>

                {logs.length > 0 && (
                    <div className="h-16 bg-black/40 border-t border-white/10 overflow-y-auto p-2 text-[9px] font-mono text-slate-500">
                        {logs.slice(-3).map((log, i) => (
                            <div key={i} className="truncate">{log}</div>
                        ))}
                    </div>
                )}
            </div>

            {/* 右侧工作区：任务处理 */}
            <ServerTaskWorkspace
                type="translation"
                translatingTasks={workspaceTranslatingTasks}
                completedTasks={workspaceCompletedTasks}
                selectedTaskId={selectedId}
                onSelectTask={setSelectedId}
                onLoadTicket={handleLoadTicket}
                onRefresh={() => {}}
            />
        </div>
    );
};

export default TranslationTasksTab;

