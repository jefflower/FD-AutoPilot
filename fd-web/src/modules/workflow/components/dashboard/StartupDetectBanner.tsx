import React from 'react';
import { useAgentContext } from '../../../../shared/agents/AgentContext';

/**
 * 启动检测进度横条 Banner
 *
 * 替代原来的全屏 StartupGate，在 AI Dashboard 顶部展示检测进度。
 * - canExecute=false 或 startupReady=true 时不展示（return null）
 * - 检测中展示每个 capability 的状态 + skill/model 探测进度
 */
const StartupDetectBanner: React.FC = () => {
    const { canExecute, startupReady, capabilityStatus, skillMap, modelMap } = useAgentContext();

    // 不需要展示的场景：纯网页端 / 检测已完成
    if (!canExecute || startupReady) {
        return null;
    }

    const hasCapabilities = capabilityStatus.length > 0;

    return (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
            {/* 标题 */}
            <div className="flex items-center gap-2 mb-3">
                {!hasCapabilities ? (
                    <>
                        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm font-medium text-slate-200">
                            正在检测本地能力...
                        </span>
                    </>
                ) : (
                    <>
                        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm font-medium text-slate-200">
                            正在检测执行环境...
                        </span>
                    </>
                )}
            </div>

            {/* Capability 列表 */}
            {hasCapabilities && (
                <div className="space-y-2">
                    {capabilityStatus.map(cap => (
                        <div
                            key={cap.code}
                            className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                                cap.available
                                    ? 'border-emerald-500/20 bg-emerald-500/5'
                                    : 'border-red-500/20 bg-red-500/5'
                            }`}
                        >
                            {/* 状态图标 */}
                            <span className="text-sm mt-0.5 flex-shrink-0">
                                {cap.available ? '\u2705' : '\u274C'}
                            </span>

                            {/* 内容 */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium text-slate-200">
                                        {cap.code}
                                    </span>
                                    {cap.version && (
                                        <span className="px-1.5 py-0.5 text-xs rounded bg-slate-700/50 text-slate-400">
                                            {cap.version.length > 30
                                                ? cap.version.substring(0, 30) + '...'
                                                : cap.version}
                                        </span>
                                    )}
                                    {!cap.available && cap.error && (
                                        <span className="text-xs text-red-400 truncate">
                                            {cap.error.length > 50
                                                ? cap.error.substring(0, 50) + '...'
                                                : cap.error}
                                        </span>
                                    )}
                                </div>

                                {/* Skill/Model 探测状态（仅可用的 capability 展示） */}
                                {cap.available && skillMap[cap.code] && (
                                    <div className="mt-1">
                                        {skillMap[cap.code].loading ? (
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
                                                <span className="text-xs text-slate-400">
                                                    探测中...
                                                </span>
                                            </div>
                                        ) : skillMap[cap.code].error ? (
                                            <span className="text-xs text-amber-400">
                                                Skill 探测失败
                                            </span>
                                        ) : (
                                            <span className="text-xs text-slate-500">
                                                {skillMap[cap.code].skills.length} Skills
                                                {modelMap[cap.code] && modelMap[cap.code].length > 0 && (
                                                    <> / {modelMap[cap.code].length} Models</>
                                                )}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 底部提示 */}
            <p className="mt-3 text-xs text-amber-400/80">
                检测完成前 Agent 暂不启动任务消费
            </p>
        </div>
    );
};

export default StartupDetectBanner;
