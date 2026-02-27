import React from 'react';
import type { AgentConsumerMapping, ShadowStatus } from './types';
import { isTauriEnv } from '../../../../tauri/bridge';

interface AgentCardProps {
    mapping: AgentConsumerMapping;
    selected: boolean;
    onSelect: () => void;
    onStart: () => void;
    onStop: () => void;
    shadowStatus?: ShadowStatus;
}

/** 判断 Agent 在浏览器模式下的可用性 */
function getBrowserCompat(providerType: string, _capability: string): { available: boolean; label: string } {
    if (providerType === 'HTTP_API' || providerType === 'LOCAL_FUNCTION') {
        return { available: true, label: '浏览器可用' };
    }
    if (providerType === 'NOTEBOOKLM') {
        return { available: true, label: '需 Bridge' };
    }
    if (providerType === 'GEMINI_CLI') {
        return { available: true, label: '需 Bridge' };
    }
    if (providerType === 'TRACKING_SHADOW') {
        return { available: false, label: '仅桌面' };
    }
    return { available: false, label: '仅桌面' };
}

const capabilityColors: Record<string, { border: string; badge: string; text: string }> = {
    translation: { border: 'border-l-cyan-500', badge: 'bg-cyan-500/10 text-cyan-400', text: 'cyan' },
    reply: { border: 'border-l-orange-500', badge: 'bg-orange-500/10 text-orange-400', text: 'orange' },
    tracking: { border: 'border-l-emerald-500', badge: 'bg-emerald-500/10 text-emerald-400', text: 'emerald' },
};
const defaultCapabilityColor = { border: 'border-l-slate-500', badge: 'bg-slate-500/10 text-slate-400', text: 'slate' };

const CALL_MODE_BADGE: Record<string, { label: string; cls: string }> = {
    MQ: { label: 'MQ', cls: 'bg-orange-500/10 text-orange-400' },
    HTTP: { label: 'HTTP', cls: 'bg-cyan-500/10 text-cyan-400' },
};

const AgentCard: React.FC<AgentCardProps> = ({
    mapping,
    selected,
    onSelect,
    onStart,
    onStop,
    shadowStatus,
}) => {
    const { definition, consumer } = mapping;
    const isRunning = consumer?.isRunning ?? false;
    const hasConsumer = consumer !== null;
    const capability = definition.capability || 'unknown';
    const colors = capabilityColors[capability] || defaultCapabilityColor;

    // 统计（仅有 consumer 时展示）
    const processingCount = consumer?.processingTasks.size ?? 0;
    const completedCount = consumer?.completedHistory.filter(t => t.status === 'completed').length ?? 0;
    const failedCount = consumer?.completedHistory.filter(t => t.status === 'failed').length ?? 0;

    const callModeBadge = definition.callMode ? CALL_MODE_BADGE[definition.callMode] : null;

    return (
        <div
            onClick={onSelect}
            className={`
                rounded-xl border-l-2 border transition-all cursor-pointer px-3 py-2.5
                ${colors.border}
                ${selected
                    ? 'border-indigo-500/50 bg-slate-800/80 shadow-lg shadow-indigo-500/5'
                    : 'border-white/5 bg-slate-800/40 hover:bg-slate-800/60 hover:border-white/10'
                }
            `}
        >
            {/* 第一行：标题行 */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            isRunning ? 'bg-emerald-400 animate-pulse'
                                : hasConsumer ? 'bg-slate-600'
                                : 'bg-slate-700'
                        }`}
                    />
                    <span className="text-xs font-semibold text-slate-200 truncate">
                        {definition.name}
                    </span>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 font-mono flex-shrink-0">
                    {definition.providerType}
                </span>
            </div>

            {/* 第二行：capability + callMode + 浏览器兼容性 */}
            <div className="flex items-center gap-2 mt-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors.badge}`}>
                    {capability}
                </span>
                {callModeBadge && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${callModeBadge.cls}`}>
                        {callModeBadge.label}
                    </span>
                )}
                {!isTauriEnv() && (() => {
                    const compat = getBrowserCompat(definition.providerType, capability);
                    return (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                            compat.available
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : 'bg-red-500/10 text-red-400'
                        }`}>
                            {compat.label}
                        </span>
                    );
                })()}
                <span className="text-[9px] text-slate-600">
                    {definition.executionEnv}
                </span>
            </div>

            {/* 第三行：统计（仅有 consumer 的 agent） */}
            {hasConsumer && (
                <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-slate-500">处理中: {processingCount}</span>
                    <span className="text-[10px] text-slate-500">完成: {completedCount}</span>
                    <span className={`text-[10px] ${failedCount > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                        失败: {failedCount}
                    </span>
                </div>
            )}

            {/* 无 consumer 时显示被动触发提示 */}
            {!hasConsumer && (
                <div className="mt-1.5">
                    <span className="text-[10px] text-slate-600 italic">工作流触发</span>
                </div>
            )}

            {/* Shadow Window 状态（NOTEBOOKLM / TRACKING_SHADOW） */}
            {(definition.providerType === 'NOTEBOOKLM' || definition.providerType === 'TRACKING_SHADOW') && shadowStatus && shadowStatus !== 'n/a' && (
                <div className="mt-1.5">
                    {shadowStatus === 'ready' ? (
                        <span className="text-[10px] text-emerald-500">Shadow Window ready</span>
                    ) : shadowStatus === 'closed' ? (
                        <span className="text-[10px] text-slate-600">Shadow Window closed</span>
                    ) : null}
                </div>
            )}

            {/* 按钮（仅有 consumer 的 agent 可启停） */}
            {hasConsumer && (
                <div className="flex items-center gap-2 mt-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onStart();
                        }}
                        disabled={isRunning}
                        className={`text-[10px] px-2 py-1 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors ${
                            isRunning ? 'opacity-40 cursor-not-allowed' : ''
                        }`}
                    >
                        启动
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onStop();
                        }}
                        disabled={!isRunning}
                        className={`text-[10px] px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors ${
                            !isRunning ? 'opacity-40 cursor-not-allowed' : ''
                        }`}
                    >
                        停止
                    </button>
                </div>
            )}
        </div>
    );
};

export default AgentCard;
