import React, { useState } from 'react';
import type { AgentConsumerMapping, MQTaskLike } from './types';
import type { ServerTicket } from '../../../../shared/types/server';
import { parseAgentConfig } from '../../../../shared/agents/schemaUtils';
import ServerTicketDetail from '../ServerTicketDetail';
import AgentExecLogPanel from '../../../../shared/components/AgentExecLogPanel';

interface AgentDetailPanelProps {
    selectedMapping: AgentConsumerMapping | null;
    selectedTicketId: number | null;
    selectedTicket: ServerTicket | null;
    onSelectTicket: (id: number | null) => void;
    onRefreshTicket: () => void;
}

/** agentConfig 中需要摘要展示的关键字段 */
const CONFIG_SUMMARY_KEYS = ['model', 'windowLabel', 'notebookId', 'targetUrl'];

function ConfigSummary({ config }: { config: Record<string, any> }) {
    const entries = CONFIG_SUMMARY_KEYS
        .filter(k => config[k] !== undefined && config[k] !== null)
        .map(k => ({ key: k, value: String(config[k]) }));

    if (entries.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-1.5 mt-2">
            {entries.map(({ key, value }) => (
                <span
                    key={key}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400"
                >
                    {key}: <span className="text-slate-300 max-w-[200px] truncate inline-block align-bottom">{value}</span>
                </span>
            ))}
        </div>
    );
}

function TaskRow({
    task,
    onClick,
    variant,
}: {
    task: MQTaskLike;
    onClick: () => void;
    variant: 'processing' | 'completed';
}) {
    const isSuccess = task.status === 'completed';
    const isFailed = task.status === 'failed';

    return (
        <div
            onClick={onClick}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-700/30 transition-colors group"
        >
            {variant === 'processing' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
            ) : isSuccess ? (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
            ) : isFailed ? (
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
            ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500 flex-shrink-0" />
            )}
            <span className="font-mono text-xs text-slate-400 flex-shrink-0">
                #{task.externalId}
            </span>
            <span className="text-xs text-slate-300 truncate min-w-0 flex-1 group-hover:text-white transition-colors">
                {task.subject}
            </span>
            {variant === 'completed' && (
                <span
                    className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                        isSuccess
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-red-500/10 text-red-400'
                    }`}
                >
                    {isSuccess ? '成功' : '失败'}
                </span>
            )}
        </div>
    );
}

const AgentDetailPanel: React.FC<AgentDetailPanelProps> = ({
    selectedMapping,
    selectedTicketId,
    selectedTicket,
    onSelectTicket,
    onRefreshTicket,
}) => {
    const [isSplitMode, setIsSplitMode] = useState(() => {
        try {
            return localStorage.getItem('fd_agent_detail_split_mode') === 'true';
        } catch {
            return false;
        }
    });

    const handleSetSplitMode = (value: boolean) => {
        setIsSplitMode(value);
        try {
            localStorage.setItem('fd_agent_detail_split_mode', String(value));
        } catch { /* ignore */ }
    };

    // ========== 视图 A: 无选中 ==========
    if (!selectedMapping) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
                <svg
                    className="w-12 h-12 mb-3 text-slate-700"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
                    />
                </svg>
                <span className="text-sm">选择一个 Agent 查看详情</span>
            </div>
        );
    }

    // ========== 视图 C: 选中具体工单 ==========
    if (selectedTicketId && selectedTicket) {
        return (
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* 返回按钮 */}
                <div className="px-4 py-2 border-b border-slate-700/50 flex-shrink-0">
                    <button
                        onClick={() => onSelectTicket(null)}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        返回 Agent 视图
                    </button>
                </div>

                {/* ServerTicketDetail */}
                <div className="flex-1 overflow-auto">
                    <ServerTicketDetail
                        ticket={selectedTicket}
                        isEmbed={true}
                        isSplitMode={isSplitMode}
                        setIsSplitMode={handleSetSplitMode}
                        onRefresh={onRefreshTicket}
                    />
                </div>
            </div>
        );
    }

    // ========== 视图 B: 选中 Agent 但无选中工单 ==========
    const { definition, consumer } = selectedMapping;
    const agentConfig = parseAgentConfig(definition.agentConfig);

    const processingTasks = consumer ? Array.from(consumer.processingTasks.values()) : [];
    const recentCompleted = consumer ? consumer.completedHistory.slice(-10).reverse() : [];

    return (
        <div className="flex-1 flex flex-col overflow-y-auto">
            {/* Agent 信息卡片 */}
            <div className="bg-slate-800/60 rounded-xl p-4 mx-4 mt-4">
                <div className="text-lg font-semibold text-white">
                    {definition.name}
                </div>
                {definition.description && (
                    <div className="text-xs text-slate-400 mt-1">{definition.description}</div>
                )}
                <div className="flex items-center gap-2 mt-2">
                    {definition.requiredCapability && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                            {definition.requiredCapability}
                        </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400">
                        {definition.capability}
                    </span>
                    {definition.groupCode && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-600/30 text-slate-400">
                            {definition.groupCode}
                        </span>
                    )}
                </div>
                {Object.keys(agentConfig).length > 0 && (
                    <ConfigSummary config={agentConfig} />
                )}
            </div>

            {/* 无 consumer 时显示提示 */}
            {!consumer && (
                <div className="mx-4 mt-4 p-3 rounded-lg bg-slate-800/40 border border-slate-700/30">
                    <div className="text-xs text-slate-500">
                        此 Agent 通过任务系统被动触发，无独立消费队列。任务由 n8n 工作流编排分发。
                    </div>
                </div>
            )}

            {/* 处理中任务列表（仅有 consumer） */}
            {consumer && (
                <div className="px-4 mt-4">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-slate-300">处理中</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
                            {processingTasks.length}
                        </span>
                    </div>
                    {processingTasks.length === 0 ? (
                        <div className="text-xs text-slate-600 py-2 px-3">暂无任务</div>
                    ) : (
                        <div className="space-y-0.5">
                            {processingTasks.map((task) => (
                                <TaskRow
                                    key={task.ticketId}
                                    task={task}
                                    onClick={() => onSelectTicket(task.ticketId)}
                                    variant="processing"
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 最近完成列表（仅有 consumer） */}
            {consumer && (
                <div className="px-4 mt-4 pb-4">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-slate-300">最近完成</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-500/10 text-slate-400 font-medium">
                            {recentCompleted.length}
                        </span>
                    </div>
                    {recentCompleted.length === 0 ? (
                        <div className="text-xs text-slate-600 py-2 px-3">暂无记录</div>
                    ) : (
                        <div className="space-y-0.5">
                            {recentCompleted.map((task) => (
                                <TaskRow
                                    key={`${task.ticketId}-${task.addedAt}`}
                                    task={task}
                                    onClick={() => onSelectTicket(task.ticketId)}
                                    variant="completed"
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 执行日志面板 */}
            <div className="px-4 mt-2 pb-4">
                <AgentExecLogPanel
                    agentCode={definition.code}
                    agentName={definition.name}
                />
            </div>
        </div>
    );
};

export default AgentDetailPanel;
