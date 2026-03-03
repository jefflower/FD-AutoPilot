interface AgentControlBarProps {
    runningCount: number;
    totalCount: number;
    allRunning: boolean;
    onStartAll: () => void;
    onStopAll: () => void;
}

export default function AgentControlBar({
    runningCount,
    totalCount,
    allRunning,
    onStartAll,
    onStopAll,
}: AgentControlBarProps) {
    const hasRunning = runningCount > 0;

    return (
        <div className="flex items-center justify-between py-2.5 px-4 bg-slate-800/50 border-b border-slate-700/50">
            {/* 左侧：图标 + 标题 + 状态 */}
            <div className="flex items-center gap-3">
                <svg
                    className="w-5 h-5 text-slate-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M12 8V4H8" />
                    <rect x="8" y="8" width="8" height="8" rx="1" />
                    <path d="M2 12h2" />
                    <path d="M20 12h2" />
                    <path d="M12 2v2" />
                    <path d="M12 20v2" />
                    <path d="M4.93 4.93l1.41 1.41" />
                    <path d="M17.66 17.66l1.41 1.41" />
                    <path d="M4.93 19.07l1.41-1.41" />
                    <path d="M17.66 6.34l1.41-1.41" />
                </svg>
                <span className="text-sm font-medium text-slate-200">
                    Agent 自动化面板
                </span>
                <span
                    className={`text-xs ${
                        hasRunning ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                >
                    运行中: {runningCount}/{totalCount}
                </span>
            </div>

            {/* 右侧：操作按钮 */}
            <div className="flex items-center gap-2">
                <button
                    onClick={onStartAll}
                    disabled={allRunning}
                    className={`px-3 py-1 text-xs rounded bg-emerald-600/20 text-emerald-400 transition-colors ${
                        allRunning
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-emerald-600/30'
                    }`}
                >
                    全部启动
                </button>
                <button
                    onClick={onStopAll}
                    disabled={runningCount === 0}
                    className={`px-3 py-1 text-xs rounded bg-red-600/20 text-red-400 transition-colors ${
                        runningCount === 0
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-red-600/30'
                    }`}
                >
                    全部停止
                </button>
            </div>
        </div>
    );
}
