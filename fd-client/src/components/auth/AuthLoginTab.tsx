/**
 * 登录页面组件 - 工单智能处理流程动画
 * 工单到达节点后停顿，进度条增加完成后进入下一节点
 */

import React, { useState, useEffect, useCallback } from 'react';

interface AuthLoginTabProps {
    onLogin: (credentials: { username: string; password: string }) => Promise<void>;
    onSwitchToRegister: () => void;
    isLoading?: boolean;
    error?: string | null;
}

// 5个处理节点（包含完成）
const NODES = [
    { id: 0, label: '同步', color: '#6366f1', icon: '🔄' },
    { id: 1, label: '翻译', color: '#06b6d4', icon: '🌐' },
    { id: 2, label: '回复', color: '#f59e0b', icon: '💬' },
    { id: 3, label: '审核', color: '#8b5cf6', icon: '✅' },
    { id: 4, label: '完成', color: '#22c55e', icon: '🎉' },
];

// 节点位置（曲线分布）
const NODE_POSITIONS = [
    { x: 100, y: 90 },   // 同步
    { x: 250, y: 130 },  // 翻译
    { x: 400, y: 90 },   // 回复
    { x: 550, y: 130 },  // 审核
    { x: 700, y: 90 },   // 完成
];

// 计算两点之间曲线上的位置
const getPositionBetweenNodes = (fromIdx: number, toIdx: number, t: number) => {
    const from = NODE_POSITIONS[fromIdx];
    const to = NODE_POSITIONS[toIdx];

    // 控制点（曲线弯曲）
    const controlY = (from.y + to.y) / 2 + (fromIdx % 2 === 0 ? 30 : -30);
    const cx = (from.x + to.x) / 2;

    // 二阶贝塞尔曲线
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * cx + t * t * to.x;
    const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * controlY + t * t * to.y;

    return { x, y };
};

const AuthLoginTab: React.FC<AuthLoginTabProps> = ({
    onLogin,
    onSwitchToRegister,
    isLoading = false,
    error,
}) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [localError, setLocalError] = useState<string | null>(null);
    const [focusedField, setFocusedField] = useState<string | null>(null);

    // 动画状态 - 使用单一状态对象避免同步问题
    const [animState, setAnimState] = useState({
        currentNode: 0,
        phase: 'processing' as 'processing' | 'moving',
        progress: 0,
        moveProgress: 0,
    });

    // 动画逻辑 - 使用函数式更新确保状态同步
    useEffect(() => {
        const interval = setInterval(() => {
            setAnimState(prev => {
                if (prev.phase === 'processing') {
                    // 在节点处理中 - 进度条增加
                    if (prev.progress >= 100) {
                        // 处理完成，开始移动到下一节点
                        return {
                            ...prev,
                            phase: 'moving',
                            progress: 0,
                            moveProgress: 0,
                        };
                    }
                    return { ...prev, progress: prev.progress + 2 };
                } else {
                    // 移动到下一节点
                    if (prev.moveProgress >= 1) {
                        // 到达下一节点，开始处理
                        const nextNode = (prev.currentNode + 1) % NODES.length;
                        return {
                            currentNode: nextNode,
                            phase: 'processing',
                            progress: 0,
                            moveProgress: 0,
                        };
                    }
                    return { ...prev, moveProgress: prev.moveProgress + 0.04 };
                }
            });
        }, 50);

        return () => clearInterval(interval);
    }, []);

    // 计算工单位置
    const getTicketPosition = useCallback(() => {
        if (animState.phase === 'processing') {
            return NODE_POSITIONS[animState.currentNode];
        } else {
            const nextNode = (animState.currentNode + 1) % NODES.length;
            // 处理从最后节点到第一个节点的特殊情况
            if (nextNode === 0) {
                // 从完成节点移出屏幕右侧，然后从左侧进入
                const t = animState.moveProgress;
                if (t < 0.5) {
                    // 移出右侧
                    const from = NODE_POSITIONS[animState.currentNode];
                    return { x: from.x + t * 200, y: from.y };
                } else {
                    // 从左侧进入
                    const to = NODE_POSITIONS[0];
                    return { x: to.x - (1 - t) * 200, y: to.y };
                }
            }
            return getPositionBetweenNodes(animState.currentNode, nextNode, animState.moveProgress);
        }
    }, [animState]);

    const ticketPos = getTicketPosition();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);

        if (!username.trim() || !password.trim()) {
            setLocalError('请输入用户名和密码');
            return;
        }

        try {
            await onLogin({ username: username.trim(), password });
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : '登录失败');
        }
    };

    const displayError = error || localError;
    const activeNode = NODES[animState.currentNode];

    // 生成曲线路径
    const curvePath = (() => {
        const segments: string[] = [];
        for (let i = 0; i < NODE_POSITIONS.length; i++) {
            const p = NODE_POSITIONS[i];
            if (i === 0) {
                segments.push(`M${p.x},${p.y}`);
            } else {
                const prev = NODE_POSITIONS[i - 1];
                const controlY = (prev.y + p.y) / 2 + ((i - 1) % 2 === 0 ? 30 : -30);
                const cx = (prev.x + p.x) / 2;
                segments.push(`Q${cx},${controlY} ${p.x},${p.y}`);
            }
        }
        return segments.join(' ');
    })();

    return (
        <div className="flex-1 flex flex-col relative overflow-hidden bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">

            {/* ===== 顶部动画区域 ===== */}
            <div className="h-[240px] relative flex-shrink-0">
                {/* 网格背景 */}
                <div
                    className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: 'linear-gradient(rgba(99,102,241,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.8) 1px, transparent 1px)',
                        backgroundSize: '30px 30px'
                    }}
                />

                {/* 状态指示器 */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-slate-800/90 backdrop-blur rounded-full px-5 py-2.5 border border-white/10 shadow-lg">
                    <span className="text-xl">{activeNode.icon}</span>
                    <span className="text-white font-medium">{activeNode.label}</span>
                    <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-75"
                            style={{
                                width: animState.phase === 'processing' ? `${animState.progress}%` : '0%',
                                backgroundColor: activeNode.color
                            }}
                        />
                    </div>
                    <span className="text-xs text-slate-400 w-8">
                        {animState.phase === 'processing' ? `${animState.progress}%` : '→'}
                    </span>
                </div>

                {/* SVG 动画层 */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 200" preserveAspectRatio="xMidYMid meet">
                    <defs>
                        <linearGradient id="pathGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#6366f1" />
                            <stop offset="25%" stopColor="#06b6d4" />
                            <stop offset="50%" stopColor="#f59e0b" />
                            <stop offset="75%" stopColor="#8b5cf6" />
                            <stop offset="100%" stopColor="#22c55e" />
                        </linearGradient>
                        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="3" result="blur" />
                            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                    </defs>

                    {/* 虚线路径 */}
                    <path
                        d={curvePath}
                        fill="none"
                        stroke="url(#pathGradient)"
                        strokeWidth="2"
                        strokeDasharray="8,4"
                        opacity="0.4"
                    />

                    {/* 处理节点 */}
                    {NODES.map((node, idx) => {
                        const pos = NODE_POSITIONS[idx];
                        const isActive = animState.currentNode === idx && animState.phase === 'processing';

                        return (
                            <g key={idx}>
                                {/* 节点光晕（活跃时） */}
                                {isActive && (
                                    <circle cx={pos.x} cy={pos.y} r="38" fill={node.color} opacity="0.15">
                                        <animate attributeName="r" values="32;42;32" dur="1s" repeatCount="indefinite" />
                                    </circle>
                                )}

                                {/* 节点圆 */}
                                <circle
                                    cx={pos.x}
                                    cy={pos.y}
                                    r="26"
                                    fill={isActive ? node.color : '#1e293b'}
                                    stroke={node.color}
                                    strokeWidth="2"
                                    filter={isActive ? 'url(#glow)' : ''}
                                    style={{ transition: 'fill 0.3s' }}
                                />

                                {/* 节点图标 */}
                                <text x={pos.x} y={pos.y + 6} textAnchor="middle" fontSize="18">{node.icon}</text>

                                {/* 节点标签 */}
                                <text
                                    x={pos.x}
                                    y={pos.y + 50}
                                    textAnchor="middle"
                                    fill={isActive ? '#fff' : '#64748b'}
                                    fontSize="12"
                                    fontWeight={isActive ? '600' : '400'}
                                >
                                    {node.label}
                                </text>
                            </g>
                        );
                    })}

                    {/* 移动的工单 */}
                    <g transform={`translate(${ticketPos.x - 16}, ${ticketPos.y - 20})`}>
                        {/* 阴影 */}
                        <rect x="3" y="3" width="32" height="40" rx="4" fill="rgba(0,0,0,0.4)" />
                        {/* 工单主体 */}
                        <rect x="0" y="0" width="32" height="40" rx="4" fill="#0f172a" stroke={activeNode.color} strokeWidth="2" />
                        {/* 标题栏 */}
                        <rect x="0" y="0" width="32" height="11" rx="4" fill={activeNode.color} />
                        <rect x="0" y="7" width="32" height="4" fill={activeNode.color} />
                        {/* 内容线 */}
                        <line x1="5" y1="18" x2="27" y2="18" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
                        <line x1="5" y1="25" x2="22" y2="25" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
                        <line x1="5" y1="32" x2="17" y2="32" stroke="#475569" strokeWidth="2" strokeLinecap="round" />

                        {/* 处理动画（活跃时闪烁） */}
                        {animState.phase === 'processing' && (
                            <rect x="-2" y="-2" width="36" height="44" rx="6" fill="none" stroke={activeNode.color} strokeWidth="2" opacity="0.5">
                                <animate attributeName="opacity" values="0.5;0.2;0.5" dur="0.8s" repeatCount="indefinite" />
                            </rect>
                        )}
                    </g>
                </svg>
            </div>

            {/* ===== 登录卡片区域 ===== */}
            <div className="flex-1 flex items-start justify-center px-6 pt-2 pb-6">
                <div className="w-full max-w-sm">
                    {/* Logo */}
                    <div className="text-center mb-4">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/30 mb-2">
                            <span className="text-white text-lg font-black">FD</span>
                        </div>
                        <h1 className="text-lg font-bold text-white">FD-AutoPilot</h1>
                        <p className="text-slate-500 text-xs">智能工单自动化处理平台</p>
                    </div>

                    {/* 卡片 */}
                    <div className="backdrop-blur-xl bg-slate-800/80 rounded-2xl border border-white/10 p-5 shadow-xl">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {displayError && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 text-red-300 text-sm flex items-center gap-2">
                                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
                                    </svg>
                                    {displayError}
                                </div>
                            )}

                            <div>
                                <label className="text-slate-400 text-xs font-medium mb-1 block">用户名</label>
                                <div className={`relative ${focusedField === 'username' ? 'z-10' : ''}`}>
                                    <div className={`absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-lg opacity-0 blur transition-opacity ${focusedField === 'username' ? 'opacity-50' : ''}`} />
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        onFocus={() => setFocusedField('username')}
                                        onBlur={() => setFocusedField(null)}
                                        placeholder="请输入用户名"
                                        className="relative w-full px-3 py-2.5 bg-slate-900/80 border border-white/10 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-slate-400 text-xs font-medium mb-1 block">密码</label>
                                <div className={`relative ${focusedField === 'password' ? 'z-10' : ''}`}>
                                    <div className={`absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg opacity-0 blur transition-opacity ${focusedField === 'password' ? 'opacity-50' : ''}`} />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onFocus={() => setFocusedField('password')}
                                        onBlur={() => setFocusedField(null)}
                                        placeholder="请输入密码"
                                        className="relative w-full px-3 py-2.5 bg-slate-900/80 border border-white/10 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading || !username.trim() || !password.trim()}
                                className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium rounded-lg transition-all disabled:opacity-50 text-sm"
                            >
                                {isLoading ? '登录中...' : '🚀 启动流水线'}
                            </button>
                        </form>

                        <div className="mt-4 pt-4 border-t border-white/10 text-center">
                            <button onClick={onSwitchToRegister} className="text-slate-500 hover:text-white text-xs transition-colors">
                                还没有账号? <span className="text-indigo-400">注册</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AuthLoginTab;
