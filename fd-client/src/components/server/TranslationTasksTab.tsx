import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { serverApi } from '../../services/serverApi';
import ServerTaskWorkspace from './ServerTaskWorkspace';

// 翻译中的工单信息
interface TranslatingTicket {
    ticketId: number;
    externalId: string;
    subject: string;
    startedAt: number;  // Unix timestamp (毫秒)
}

// 已完成翻译的工单信息
interface CompletedTicket {
    ticketId: number;
    externalId: string;
    subject: string;
    startedAt: number;
    completedAt: number;
    durationMs: number;  // 耗时(毫秒)
    success: boolean;
    errorMessage: string | null;
}

interface MqConsumerStatus {
    isRunning: boolean;
    batchSize: number;
    currentTask: string | null;
    translatingTickets: TranslatingTicket[];
    completedTickets: CompletedTicket[];
}

const TranslationTasksTab: React.FC = () => {
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);

    // MQ 消费状态
    const [mqStatus, setMqStatus] = useState<MqConsumerStatus>({
        isRunning: false,
        batchSize: 5,
        currentTask: null,
        translatingTickets: [],
        completedTickets: []
    });
    const [mqStarting, setMqStarting] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);

    // 批量配置
    const [batchSizeInput, setBatchSizeInput] = useState<string>('5');
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [hasInitialized, setHasInitialized] = useState(false);
    const batchSizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 轮询 MQ 状态
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await invoke<MqConsumerStatus>('get_mq_consumer_status');
                setMqStatus(status);
                // 仅在非聚焦状态下同步服务端值
                if (!isInputFocused && status.batchSize) {
                    if (!hasInitialized || status.batchSize.toString() !== batchSizeInput) {
                        setBatchSizeInput(status.batchSize.toString());
                        setHasInitialized(true);
                    }
                }
            } catch (err) {
                console.error('Failed to get MQ status:', err);
            }
        };

        checkStatus();
        const interval = setInterval(checkStatus, 3000); // 降低频率
        return () => clearInterval(interval);
    }, [isInputFocused]); // 依赖聚焦状态，失焦时立即触发一次同步

    // 监听日志事件
    useEffect(() => {
        let unlisten: (() => void) | null = null;
        import('@tauri-apps/api/event').then(({ listen }) => {
            listen<string>('log', (event) => {
                setLogs(prev => [...prev.slice(-50), event.payload]);
            }).then((fn) => {
                unlisten = fn;
            });
        });

        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    // 启动 MQ 消费
    const handleStartMq = async () => {
        setMqStarting(true);
        setError(null);
        try {
            const authToken = localStorage.getItem('fd_auth_token') || '';
            await invoke('start_mq_consumer', { authToken });
            setLogs(prev => [...prev, '🐰 MQ 消费已启动']);
        } catch (err) {
            setError(err instanceof Error ? err.message : '启动失败');
        } finally {
            setMqStarting(false);
        }
    };

    // 停止 MQ 消费
    const handleStopMq = async () => {
        try {
            await invoke('stop_mq_consumer');
            setLogs(prev => [...prev, '🛑 MQ 消费已停止']);
        } catch (err) {
            setError(err instanceof Error ? err.message : '停止失败');
        }
    };

    // 更新批量大小
    const handleBatchSizeChange = (value: string) => {
        setBatchSizeInput(value);
        if (batchSizeDebounceRef.current) {
            clearTimeout(batchSizeDebounceRef.current);
        }
        batchSizeDebounceRef.current = setTimeout(async () => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0 && num <= 100) {
                try {
                    await invoke('update_mq_batch_size', { batchSize: num });
                } catch (err) {
                    console.error('Failed to update batch size:', err);
                }
            }
        }, 500);
    };

    const handleLoadTicket = useCallback(async (ticketId: number) => {
        return await serverApi.ticket.getTicketById(ticketId);
    }, []);

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧控制区 */}
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                <div className="p-4 border-b border-white/10 bg-gradient-to-br from-cyan-900/40 to-blue-900/20">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                            <span className="w-1 h-3 bg-cyan-500 rounded-full"></span>
                            MQ 自动翻译
                        </h3>
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${mqStatus.isRunning
                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                            : 'bg-slate-800 text-slate-500 border border-white/5'
                            }`}>
                            {mqStatus.isRunning ? 'Running' : 'Stopped'}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex gap-2">
                            {!mqStatus.isRunning ? (
                                <button
                                    onClick={handleStartMq}
                                    disabled={mqStarting}
                                    className="flex-1 h-9 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50 shadow-lg shadow-cyan-900/20"
                                >
                                    {mqStarting ? '启动中...' : '启动消费'}
                                </button>
                            ) : (
                                <button
                                    onClick={handleStopMq}
                                    className="flex-1 h-9 bg-red-500/80 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition-all"
                                >
                                    停止消费
                                </button>
                            )}
                        </div>

                        <div className="flex items-center justify-between px-1">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">并发批量大小</span>
                            <input
                                type="number"
                                min={1}
                                max={100}
                                value={batchSizeInput}
                                onFocus={() => setIsInputFocused(true)}
                                onBlur={() => setIsInputFocused(false)}
                                onChange={(e) => handleBatchSizeChange(e.target.value)}
                                className="w-14 h-7 bg-black/40 border border-white/5 rounded text-cyan-400 text-xs text-center font-mono focus:outline-none focus:border-cyan-500/50"
                            />
                        </div>
                    </div>

                    {mqStatus.currentTask && (
                        <div className="mt-4 p-2 bg-black/20 rounded border border-white/5 text-[10px] text-cyan-300 font-medium animate-pulse truncate">
                            📝 {mqStatus.currentTask}
                        </div>
                    )}
                </div>

                {/* 任务列表展示联动 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-4">
                    {/* 正在处理列表 */}
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                <span className="w-1 h-1 bg-cyan-400 rounded-full animate-ping"></span>
                                Processing
                            </h4>
                            <span className="text-[10px] font-mono text-cyan-500/50">({mqStatus.translatingTickets.length})</span>
                        </div>
                        <div className="space-y-1">
                            {mqStatus.translatingTickets.map(task => (
                                <button
                                    key={task.ticketId}
                                    onClick={() => setSelectedId(task.ticketId)}
                                    className={`w-full text-left p-2 rounded-lg transition-all border group ${selectedId === task.ticketId
                                        ? 'bg-cyan-500/10 border-cyan-500/30 shadow-lg shadow-cyan-500/5'
                                        : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/5'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[10px] font-bold text-cyan-400 opacity-60 group-hover:opacity-100 transition-opacity">#{task.externalId}</span>
                                        <div className="w-1 h-1 bg-cyan-400 rounded-full"></div>
                                    </div>
                                    <div className="text-[11px] text-slate-300 truncate font-medium group-hover:text-white transition-colors">{task.subject}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 已完成列表 */}
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2 mt-4">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Completed</h4>
                            <span className="text-[10px] font-mono text-green-500/50">({mqStatus.completedTickets.length})</span>
                        </div>
                        <div className="space-y-1">
                            {mqStatus.completedTickets.map(task => (
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
                                        <span className={`text-[9px] font-black uppercase tracking-tighter ${task.success ? 'text-green-500/50' : 'text-red-500/50'}`}>
                                            {task.success ? 'Done' : 'Fail'}
                                        </span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 truncate group-hover:text-slate-200 transition-colors">{task.subject}</div>
                                </button>
                            ))}
                            {mqStatus.completedTickets.length === 0 && (
                                <div className="text-center py-6 text-slate-600 text-[10px] italic border border-dashed border-white/5 rounded-xl">暂无已完成工单</div>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="m-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400 font-bold">
                            ⚠️ {error}
                        </div>
                    )}
                </div>

                {/* 精简日志 */}

                {/* 精简日志 */}
                <div className="h-32 border-t border-white/10 bg-black/20 p-2 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between text-[9px] font-black text-slate-600 uppercase tracking-[0.2em] mb-1.5 px-1">
                        <span>MQ LOGS</span>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar text-[10px] font-mono text-slate-500 space-y-1">
                        {logs.slice(-20).map((log, i) => (
                            <div key={i} className="truncate px-1 opacity-70 hover:opacity-100 transition-opacity">
                                <span className="text-cyan-900 mr-1.5">›</span>{log}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* 右侧工作区：多标签页 */}
            <ServerTaskWorkspace
                type="translation"
                translatingTasks={mqStatus.translatingTickets}
                completedTasks={mqStatus.completedTickets}
                selectedTaskId={selectedId}
                onSelectTask={setSelectedId}
                onLoadTicket={handleLoadTicket}
            />
        </div>
    );
};

export default TranslationTasksTab;
