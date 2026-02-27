import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { serverApi } from '../../../shared/services/serverApi';
import ServerTaskWorkspace from '../pages/ServerTaskWorkspace';
import type { MQTask } from '../../../shared/context/createMQTaskContext';
import TaskStatusBadge from './TaskStatusBadge';
import ConsumerControlButtons from './ConsumerControlButtons';
import CompletedTaskCard from './CompletedTaskCard';
import EmptyStateHint from './EmptyStateHint';
import LogPanel from './LogPanel';

type ThemeColor = 'cyan' | 'orange';

interface MQConsumerTaskTabLabels {
    statusRunning: string;
    statusStopped: string;
    startConsumer: string;
    stopConsumer: string;
    processing: string;
    completedHistory: string;
    idle: string;
    noCompleted: string;
    statusDone: string;
    statusFailed: string;
    statusSkipped: string;
}

interface MQConsumerTaskTabProps {
    // MQ Context 数据
    processingTasks: Map<number, MQTask>;
    completedHistory: MQTask[];
    isRunning: boolean;
    startConsumer: () => void;
    stopConsumer: () => void;
    logs: string[];

    // 外观配置
    color: ThemeColor;
    title: string;
    workspaceType: 'translation' | 'reply';

    // i18n 标签
    labels: MQConsumerTaskTabLabels;

    // 可选：头部额外控件（翻译页面的并发数控制）
    headerExtra?: React.ReactNode;

    // 外部导航支持
    initialSelectedId?: number | null;
    onNavigated?: () => void;
}

const GRADIENT_STYLES: Record<ThemeColor, string> = {
    cyan: 'from-cyan-900/40 to-blue-900/20',
    orange: 'from-orange-900/40 to-red-900/20',
};

const ACCENT_STYLES: Record<ThemeColor, { bar: string; dot: string; dotPulse: string; count: string; selected: string; id: string; indicator: string }> = {
    cyan: {
        bar: 'bg-cyan-500',
        dot: 'bg-cyan-400 animate-ping',
        dotPulse: 'bg-cyan-400 animate-pulse',
        count: 'text-cyan-500/50',
        selected: 'bg-cyan-500/10 border-cyan-500/30 shadow-lg shadow-cyan-500/5 z-10',
        id: 'text-cyan-400',
        indicator: 'bg-cyan-500',
    },
    orange: {
        bar: 'bg-orange-500',
        dot: 'bg-orange-400 animate-ping',
        dotPulse: 'bg-orange-400 animate-pulse',
        count: 'text-orange-500/50',
        selected: 'bg-orange-500/10 border-orange-500/30 shadow-lg shadow-orange-500/5 z-10',
        id: 'text-orange-400',
        indicator: 'bg-orange-500',
    },
};

const MQConsumerTaskTab: React.FC<MQConsumerTaskTabProps> = ({
    processingTasks, completedHistory, isRunning, startConsumer, stopConsumer, logs,
    color, title, workspaceType, labels, headerExtra,
    initialSelectedId, onNavigated
}) => {
    const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId ?? null);
    const accent = ACCENT_STYLES[color];

    // 处理外部导航（来自 FloatingTaskWidget）
    useEffect(() => {
        if (initialSelectedId) {
            setSelectedId(initialSelectedId);
            onNavigated?.();
        }
    }, [initialSelectedId, onNavigated]);

    const handleLoadTicket = useCallback(async (ticketId: number) => {
        return await serverApi.ticket.getTicketById(ticketId);
    }, []);

    // Convert Map to Array for display
    const processingList = Array.from(processingTasks.values());
    const processingTicketIds = new Set(processingList.map(t => t.ticketId));

    // 过滤 completedHistory：排除正在处理中的 ticketId（防止重试时 key 冲突）
    const filteredCompletedHistory = completedHistory.filter(t => !processingTicketIds.has(t.ticketId));

    // Map to ServerTaskWorkspace Task format (memoized: only recompute when ticket IDs change)
    const processingKey = processingList.map(t => t.ticketId).join(',');
    const workspaceTasks = useMemo(() => processingList.map(t => ({
        ticketId: t.ticketId,
        externalId: t.externalId,
        subject: t.subject,
        startedAt: t.addedAt,
        isProcessed: false,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    })), [processingKey]);

    const completedKey = filteredCompletedHistory.map(t => `${t.ticketId}:${t.status}`).join(',');
    const workspaceCompletedTasks = useMemo(() => filteredCompletedHistory.map(t => ({
        ticketId: t.ticketId,
        externalId: t.externalId,
        subject: t.subject,
        startedAt: t.addedAt,
        completedAt: t.addedAt,
        success: t.status === 'completed' || t.status === 'skipped',
        isProcessed: true,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    })), [completedKey]);

    const getStatusLabel = (status: string) => {
        if (status === 'skipped') return labels.statusSkipped;
        if (status === 'completed') return labels.statusDone;
        return labels.statusFailed;
    };

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* 左侧控制区 + 任务列表 */}
            <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
                <div className={`p-4 border-b border-white/10 bg-gradient-to-br ${GRADIENT_STYLES[color]}`}>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-white text-sm tracking-wide flex items-center gap-2">
                            <span className={`w-1 h-3 ${accent.bar} rounded-full`}></span>
                            {title}
                        </h3>
                        <TaskStatusBadge
                            isActive={isRunning}
                            activeLabel={labels.statusRunning}
                            inactiveLabel={labels.statusStopped}
                            color={color}
                        />
                    </div>

                    <div className="space-y-3">
                        <ConsumerControlButtons
                            isRunning={isRunning}
                            onStart={startConsumer}
                            onStop={stopConsumer}
                            startLabel={labels.startConsumer}
                            stopLabel={labels.stopConsumer}
                            color={color}
                        />
                        {headerExtra}
                    </div>
                </div>

                {/* 任务列表 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-4">
                    {/* 正在处理列表 */}
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                {processingList.length > 0 && <span className={`w-1.5 h-1.5 ${accent.dot} rounded-full`}></span>}
                                {labels.processing}
                            </h4>
                            <span className={`text-[10px] font-mono ${accent.count}`}>({processingList.length})</span>
                        </div>

                        <div className="space-y-1">
                            {processingList.map(task => (
                                <button
                                    key={task.ticketId}
                                    onClick={() => setSelectedId(task.ticketId)}
                                    className={`w-full text-left p-2.5 rounded-lg transition-all border group relative ${
                                        selectedId === task.ticketId
                                            ? accent.selected
                                            : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/5'
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className={`text-[11px] font-bold font-mono ${accent.id} opacity-80 group-hover:opacity-100 transition-opacity`}>
                                            #{task.externalId}
                                        </span>
                                        <div className={`w-1.5 h-1.5 ${accent.dotPulse} rounded-full`}></div>
                                    </div>
                                    <div className="text-[11px] text-slate-300 truncate font-medium group-hover:text-white transition-colors">
                                        {task.subject}
                                    </div>
                                    {selectedId === task.ticketId && (
                                        <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${accent.indicator} rounded-l-lg`}></div>
                                    )}
                                </button>
                            ))}

                            {processingList.length === 0 && (
                                <EmptyStateHint message={labels.idle} />
                            )}
                        </div>
                    </div>

                    {/* 已完成列表 */}
                    <div>
                        <div className="flex items-center justify-between px-2 mb-2 mt-4">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                                {labels.completedHistory}
                            </h4>
                            <span className="text-[10px] font-mono text-green-500/50">({filteredCompletedHistory.length})</span>
                        </div>
                        <div className="space-y-1">
                            {filteredCompletedHistory.map(task => (
                                <CompletedTaskCard
                                    key={task.ticketId}
                                    ticketId={task.ticketId}
                                    externalId={task.externalId}
                                    subject={task.subject}
                                    status={task.status}
                                    statusLabel={getStatusLabel(task.status)}
                                    isSelected={selectedId === task.ticketId}
                                    onSelect={setSelectedId}
                                />
                            ))}
                            {filteredCompletedHistory.length === 0 && (
                                <EmptyStateHint message={labels.noCompleted} />
                            )}
                        </div>
                    </div>
                </div>

                <LogPanel logs={logs} />
            </div>

            {/* 右侧工作区 */}
            <ServerTaskWorkspace
                type={workspaceType}
                translatingTasks={workspaceTasks}
                completedTasks={workspaceCompletedTasks}
                selectedTaskId={selectedId}
                onSelectTask={setSelectedId}
                onLoadTicket={handleLoadTicket}
                onRefresh={() => {}}
            />
        </div>
    );
};

export default MQConsumerTaskTab;
