import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { serverApi } from '../../services/serverApi';
// import { NotebookShadowService } from '../../services/notebookShadow';
import ServerTaskWorkspace from './ServerTaskWorkspace';
import { useSettings } from '../../hooks/useSettings';
import { useNotebookShadow } from '../../hooks/useNotebookShadow';

// MQ 消费状态接口
interface MqConsumerStatus {
    isRunning: boolean;
    batchSize: number;
    currentTask: string | null;
    translatingTickets: TranslatingTicket[];
    completedTickets: CompletedTicket[];
}

interface TranslatingTicket {
    ticketId: number;
    externalId: string;
    subject: string;
    startedAt: number;
}

interface CompletedTicket {
    ticketId: number;
    externalId: string;
    subject: string;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    success: boolean;
    errorMessage?: string;
}

const ReplyTasksTab: React.FC = () => {
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [mqStatus, setMqStatus] = useState<MqConsumerStatus>({
        isRunning: false,
        batchSize: 1,
        currentTask: null,
        translatingTickets: [],
        completedTickets: []
    });

    const [logs, setLogs] = useState<string[]>([]);
    const [mqStarting, setMqStarting] = useState(false);
    const logEndRef = useRef<HTMLDivElement>(null);

    const { } = useSettings();
    const { visible: shadowVisible, toggle: handleToggleShadow } = useNotebookShadow();

    // 自动滚动日志
    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    // 获取 MQ 状态
    const updateMqStatus = useCallback(async () => {
        try {
            const status = await invoke<MqConsumerStatus>('get_reply_mq_consumer_status');
            setMqStatus(status);
        } catch (error) {
            console.error('Failed to get MQ status:', error);
        }
    }, []);

    // 初始化和监听
    useEffect(() => {
        updateMqStatus();
        const timer = setInterval(updateMqStatus, 2000);

        const unlisten = listen<string>('log', (event) => {
            if (event.payload.toLowerCase().includes('reply')) {
                setLogs(prev => [...prev.slice(-49), event.payload]);
            }
        });

        return () => {
            clearInterval(timer);
            unlisten.then(f => f());
        };
    }, [updateMqStatus]);

    const handleStartMq = async () => {
        setMqStarting(true);
        setError(null);
        try {
            const token = localStorage.getItem('fd_auth_token') || '';
            await invoke('start_reply_mq_consumer', { authToken: token });
            setLogs(prev => [...prev, '🐰 Reply MQ 消费已启动']);
        } catch (err: any) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setMqStarting(false);
        }
    };

    const handleStopMq = async () => {
        try {
            await invoke('stop_reply_mq_consumer');
            setLogs(prev => [...prev, '🛑 Reply MQ 消费停止中...']);
        } catch (err: any) {
            console.error('Stop failed:', err);
        }
    };

    const handleLoadTicket = useCallback(async (ticketId: number) => {
        return await serverApi.ticket.getTicketById(ticketId);
    }, []);

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧控制区 */}
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                <div className="p-4 border-b border-white/10 bg-gradient-to-br from-orange-900/40 to-red-900/20">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                            <span className="w-1 h-3 bg-orange-500 rounded-full"></span>
                            MQ 自动回复
                        </h3>
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${mqStatus.isRunning
                            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
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
                                    className="flex-1 h-9 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50 shadow-lg shadow-orange-900/20"
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
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">单任务执行模式</span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleToggleShadow}
                                    className={`px-2 h-6 rounded border text-[9px] font-bold transition-all ${shadowVisible
                                        ? 'bg-purple-500 border-purple-400 text-white'
                                        : 'bg-slate-800 border-white/10 text-slate-500 hover:text-slate-300'
                                        }`}
                                >
                                    BROWSER
                                </button>
                                <div className="text-[10px] text-orange-400 font-mono">FIXED 1</div>
                            </div>
                        </div>
                    </div>

                    {mqStatus.currentTask && (
                        <div className="mt-4 p-2 bg-black/20 rounded border border-white/5 text-[10px] text-orange-300 font-medium animate-pulse truncate">
                            📝 {mqStatus.currentTask}
                        </div>
                    )}
                </div>

                {/* 任务列表展示联动 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-4">
                    {/* 正在生成列表 */}
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                <span className="w-1 h-1 bg-orange-400 rounded-full animate-ping"></span>
                                Generating
                            </h4>
                            <span className="text-[10px] font-mono text-orange-500/50">({mqStatus.translatingTickets.length})</span>
                        </div>
                        <div className="space-y-1">
                            {mqStatus.translatingTickets.map(task => (
                                <button
                                    key={task.ticketId}
                                    onClick={() => setSelectedId(task.ticketId)}
                                    className={`w-full text-left p-2 rounded-lg transition-all border group ${selectedId === task.ticketId
                                        ? 'bg-orange-500/10 border-orange-500/30'
                                        : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/5'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[10px] font-bold text-orange-400 opacity-60 group-hover:opacity-100 transition-opacity">#{task.externalId}</span>
                                        <div className="w-1 h-1 bg-orange-400 rounded-full"></div>
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
                                            Done
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

                <div className="h-32 border-t border-white/10 bg-black/20 p-2 overflow-hidden flex flex-col font-sans">
                    <div className="flex items-center justify-between text-[9px] font-black text-slate-600 uppercase tracking-[0.2em] mb-1.5 px-1">
                        <span>REPLY LOGS</span>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar text-[10px] font-mono text-slate-500 space-y-1">
                        {logs.slice(-20).map((log, i) => (
                            <div key={i} className="truncate px-1 opacity-70 hover:opacity-100 transition-opacity">
                                <span className="text-orange-900 mr-1.5">›</span>{log}
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>
                </div>
            </div>

            {/* 右侧工作区：多标签页 */}
            <ServerTaskWorkspace
                type="reply"
                translatingTasks={mqStatus.translatingTickets}
                completedTasks={mqStatus.completedTickets}
                selectedTaskId={selectedId}
                onSelectTask={setSelectedId}
                onLoadTicket={handleLoadTicket}
            />
        </div>
    );
};

export default ReplyTasksTab;
