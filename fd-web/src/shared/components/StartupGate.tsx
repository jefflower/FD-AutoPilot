import React, { useState, useCallback } from 'react';
import { useAgentContext } from '../agents/AgentContext';

/**
 * 启动锁屏组件：有执行能力时展示本地 Capability 检测结果 + AI Skill 探测
 *
 * - canExecute=false（纯网页端）：不展示，直接渲染 children
 * - canExecute=true：展示能力检测结果，等待检测完成后可进入系统
 *
 * Skill 检测已在 AgentContext 中完成，本组件仅从 context 读取展示。
 */
export const StartupGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { canExecute, startupReady, capabilityStatus, skillMap, modelMap } = useAgentContext();
    const [dismissed, setDismissed] = useState(false);

    const handleEnter = useCallback(() => {
        setDismissed(true);
    }, []);

    // 纯网页端或已关闭锁屏：直接渲染 children
    if (!canExecute || dismissed) {
        return <>{children}</>;
    }

    // 等待 AgentContext 初始化
    if (!startupReady) {
        return (
            <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-slate-400">正在检测执行环境...</p>
                </div>
            </div>
        );
    }

    // 是否全部检测完成：startupReady=true 且所有 skill 条目不再 loading
    const allDone = startupReady && Object.values(skillMap).every(s => !s.loading);

    return (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/95 backdrop-blur-sm">
            <div className="w-[480px] bg-slate-900 border border-slate-700/70 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-700/50">
                    <h2 className="text-lg font-semibold text-white">FD-AutoPilot 启动检测</h2>
                    <p className="text-xs text-slate-400 mt-1">正在检测本地 AI 执行能力...</p>
                </div>

                {/* Capability 列表 */}
                <div className="px-6 py-4 space-y-3">
                    {capabilityStatus.map(cap => (
                        <div
                            key={cap.code}
                            className={`rounded-lg border p-3 transition-all ${
                                cap.available
                                    ? 'border-emerald-500/30 bg-emerald-500/5'
                                    : 'border-red-500/30 bg-red-500/5'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className={`text-base ${cap.available ? '' : 'opacity-60'}`}>
                                        {cap.available ? '\u2705' : '\u274C'}
                                    </span>
                                    <span className="text-sm font-medium text-slate-200">
                                        {cap.code}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {cap.version && (
                                        <span className="px-2 py-0.5 text-xs rounded bg-slate-700/50 text-slate-300">
                                            {cap.version.length > 30
                                                ? cap.version.substring(0, 30) + '...'
                                                : cap.version}
                                        </span>
                                    )}
                                    {!cap.available && cap.error && (
                                        <span className="text-xs text-red-400">
                                            {cap.error.length > 40
                                                ? cap.error.substring(0, 40) + '...'
                                                : cap.error}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Skill 列表 */}
                            {cap.available && skillMap[cap.code] && (
                                <div className="mt-2 pt-2 border-t border-slate-700/30">
                                    {skillMap[cap.code].loading ? (
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
                                            <span className="text-xs text-slate-400">
                                                正在探测 AI Skills...
                                            </span>
                                        </div>
                                    ) : skillMap[cap.code].error ? (
                                        <p className="text-xs text-amber-400">
                                            Skill 探测失败: {skillMap[cap.code].error!.substring(0, 60)}
                                        </p>
                                    ) : skillMap[cap.code].skills.length > 0 ? (
                                        <div className="space-y-1.5">
                                            <div className="flex flex-wrap gap-1.5">
                                                {skillMap[cap.code].skills.map((skill, i) => (
                                                    <span
                                                        key={i}
                                                        className="px-2 py-0.5 text-xs rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 cursor-help"
                                                        title={`${skill.description}${skill.command ? '\n命令: ' + skill.command : ''}`}
                                                    >
                                                        {skill.name}
                                                    </span>
                                                ))}
                                            </div>
                                            {/* 展示第一个有 command 的 skill 作为示例 */}
                                            {skillMap[cap.code].skills.some(s => s.command) && (
                                                <p className="text-[10px] text-slate-500 font-mono truncate" title="示例命令">
                                                    $ {skillMap[cap.code].skills.find(s => s.command)?.command}
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-500">
                                            未检测到 Skills
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Model 列表 */}
                            {modelMap[cap.code] && modelMap[cap.code].length > 0 && (
                                <div className="mt-1.5 pt-1.5 border-t border-slate-700/20">
                                    <p className="text-[10px] text-slate-500">
                                        <span className="text-slate-400">模型:</span>{' '}
                                        {modelMap[cap.code].join(', ')}
                                    </p>
                                </div>
                            )}
                        </div>
                    ))}

                    {capabilityStatus.length === 0 && (
                        <div className="text-center py-4">
                            <p className="text-sm text-slate-400">未检测到任何 Capability</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-700/50">
                    <button
                        onClick={handleEnter}
                        disabled={!allDone}
                        className={`w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                            allDone
                                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                                : 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                        }`}
                    >
                        {allDone ? '进入系统' : '检测中...'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StartupGate;
