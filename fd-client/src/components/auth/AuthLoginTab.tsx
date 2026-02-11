/**
 * 登录页面组件 - 全新设计
 * 左右分屏布局：左侧工单流水线动画展示，右侧登录表单
 * 特效：极光背景、浮动粒子、S-wave 流水线、玻璃态表单
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getServerBaseUrl, setServerBaseUrl } from '../../services/serverApi';

interface AuthLoginTabProps {
    onLogin: (credentials: { username: string; password: string }) => Promise<void>;
    onSwitchToRegister: () => void;
    isLoading?: boolean;
    error?: string | null;
}

// ===== 节点配置 =====
const NODES = [
    { id: 0, color: '#6366f1', lightColor: '#818cf8' },
    { id: 1, color: '#06b6d4', lightColor: '#22d3ee' },
    { id: 2, color: '#f59e0b', lightColor: '#fbbf24' },
    { id: 3, color: '#8b5cf6', lightColor: '#a78bfa' },
    { id: 4, color: '#22c55e', lightColor: '#4ade80' },
];

const PIPELINE_KEYS = ['sync', 'translate', 'reply', 'audit', 'push'];

// SVG 图标路径 (heroicons outline, viewBox 0 0 24 24)
const NODE_ICON_PATHS = [
    // Sync - 刷新箭头
    'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    // Translate - 语言
    'M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129',
    // Reply - 对话
    'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    // Audit - 审核勾选
    'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    // Complete - 星光
    'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
];

// S-wave 节点位置 (viewBox 0 0 730 320)
const NODE_POSITIONS = [
    { x: 90, y: 90 },    // 同步 (上)
    { x: 240, y: 230 },  // 翻译 (下)
    { x: 390, y: 90 },   // 回复 (上)
    { x: 540, y: 230 },  // 审核 (下)
    { x: 640, y: 90 },   // 完成 (上)
];

// 浮动粒子配置 (模块级常量，避免重复生成)
const PARTICLES = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: Math.random() * 3 + 1,
    duration: Math.random() * 20 + 15,
    delay: Math.random() * -20,
    opacity: Math.random() * 0.3 + 0.1,
    color: NODES[i % 5].color,
}));

// 贝塞尔曲线插值
const getPositionBetweenNodes = (fromIdx: number, toIdx: number, t: number) => {
    const from = NODE_POSITIONS[fromIdx];
    const to = NODE_POSITIONS[toIdx];
    const controlY = (from.y + to.y) / 2 + (fromIdx % 2 === 0 ? 40 : -40);
    const cx = (from.x + to.x) / 2;
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
    const { t } = useTranslation('auth');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [localError, setLocalError] = useState<string | null>(null);
    const [showForgotPassword, setShowForgotPassword] = useState(false);
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const [showServerConfig, setShowServerConfig] = useState(false);
    const [serverUrl, setServerUrlLocal] = useState(getServerBaseUrl);
    const [mounted, setMounted] = useState(false);

    // 动画状态
    const [animState, setAnimState] = useState({
        currentNode: 0,
        phase: 'processing' as 'processing' | 'moving',
        progress: 0,
        moveProgress: 0,
    });

    // 入场动画
    useEffect(() => {
        const timer = setTimeout(() => setMounted(true), 100);
        return () => clearTimeout(timer);
    }, []);

    // 动画逻辑
    useEffect(() => {
        const interval = setInterval(() => {
            setAnimState(prev => {
                if (prev.phase === 'processing') {
                    if (prev.progress >= 100) {
                        return { ...prev, phase: 'moving', progress: 0, moveProgress: 0 };
                    }
                    return { ...prev, progress: prev.progress + 2 };
                } else {
                    if (prev.moveProgress >= 1) {
                        const nextNode = (prev.currentNode + 1) % NODES.length;
                        return { currentNode: nextNode, phase: 'processing', progress: 0, moveProgress: 0 };
                    }
                    return { ...prev, moveProgress: prev.moveProgress + 0.04 };
                }
            });
        }, 50);
        return () => clearInterval(interval);
    }, []);

    // 工单位置计算
    const getTicketPosition = useCallback(() => {
        if (animState.phase === 'processing') {
            return NODE_POSITIONS[animState.currentNode];
        }
        const nextNode = (animState.currentNode + 1) % NODES.length;
        if (nextNode === 0) {
            const t = animState.moveProgress;
            if (t < 0.5) {
                const from = NODE_POSITIONS[animState.currentNode];
                return { x: from.x + t * 200, y: from.y };
            } else {
                const to = NODE_POSITIONS[0];
                return { x: to.x - (1 - t) * 200, y: to.y };
            }
        }
        return getPositionBetweenNodes(animState.currentNode, nextNode, animState.moveProgress);
    }, [animState]);

    const ticketPos = getTicketPosition();
    const activeNode = NODES[animState.currentNode];

    // 曲线路径
    const curvePath = useMemo(() => {
        const segments: string[] = [];
        for (let i = 0; i < NODE_POSITIONS.length; i++) {
            const p = NODE_POSITIONS[i];
            if (i === 0) {
                segments.push(`M${p.x},${p.y}`);
            } else {
                const prev = NODE_POSITIONS[i - 1];
                const controlY = (prev.y + p.y) / 2 + ((i - 1) % 2 === 0 ? 40 : -40);
                const cx = (prev.x + p.x) / 2;
                segments.push(`Q${cx},${controlY} ${p.x},${p.y}`);
            }
        }
        return segments.join(' ');
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);
        if (!username.trim() || !password.trim()) {
            setLocalError(t('login.validationRequired'));
            return;
        }
        try {
            await onLogin({ username: username.trim(), password });
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : t('login.loginFailed'));
        }
    };

    const displayError = error || localError;

    return (
        <div className="h-full w-full flex flex-row relative overflow-hidden bg-slate-950">

            {/* ===== 左侧面板 - 流水线动画展示 ===== */}
            <div className="w-[55%] relative overflow-hidden flex flex-col">

                {/* 极光背景 */}
                <div className="absolute inset-0 pointer-events-none">
                    <div
                        className="absolute -top-1/4 -left-1/4 w-[600px] h-[600px] rounded-full blur-[120px] opacity-20"
                        style={{ background: 'radial-gradient(circle, #6366f1, transparent)', animation: 'aurora1 15s ease-in-out infinite' }}
                    />
                    <div
                        className="absolute -bottom-1/4 -right-1/4 w-[500px] h-[500px] rounded-full blur-[100px] opacity-15"
                        style={{ background: 'radial-gradient(circle, #8b5cf6, transparent)', animation: 'aurora2 12s ease-in-out infinite alternate' }}
                    />
                    <div
                        className="absolute top-1/3 left-1/3 w-[400px] h-[400px] rounded-full blur-[80px] opacity-10"
                        style={{ background: 'radial-gradient(circle, #06b6d4, transparent)', animation: 'aurora3 18s ease-in-out infinite' }}
                    />
                </div>

                {/* 网格背景 */}
                <div
                    className="absolute inset-0 opacity-[0.04] pointer-events-none"
                    style={{
                        backgroundImage: 'linear-gradient(rgba(99,102,241,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.6) 1px, transparent 1px)',
                        backgroundSize: '40px 40px'
                    }}
                />

                {/* 浮动粒子 */}
                {PARTICLES.map(p => (
                    <div
                        key={p.id}
                        className="absolute rounded-full pointer-events-none"
                        style={{
                            left: `${p.left}%`,
                            top: `${p.top}%`,
                            width: p.size,
                            height: p.size,
                            backgroundColor: p.color,
                            opacity: p.opacity,
                            animation: `floatParticle ${p.duration}s ease-in-out infinite`,
                            animationDelay: `${p.delay}s`,
                        }}
                    />
                ))}

                {/* 状态指示器 */}
                <div className={`absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-slate-900/80 backdrop-blur-xl rounded-full px-6 py-3 border border-white/10 shadow-2xl z-10 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
                    <div
                        className="w-2.5 h-2.5 rounded-full animate-pulse"
                        style={{ backgroundColor: activeNode.color, boxShadow: `0 0 12px ${activeNode.color}` }}
                    />
                    <span className="text-white font-semibold text-sm tracking-wide">{t(`pipeline.${PIPELINE_KEYS[animState.currentNode]}` as any)}</span>
                    <div className="w-32 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-75"
                            style={{
                                width: animState.phase === 'processing' ? `${animState.progress}%` : '0%',
                                background: `linear-gradient(90deg, ${activeNode.color}, ${activeNode.lightColor})`,
                                boxShadow: `0 0 8px ${activeNode.color}60`,
                            }}
                        />
                    </div>
                    <span className="text-xs text-slate-500 font-mono w-10 text-right">
                        {animState.phase === 'processing' ? `${animState.progress}%` : 'MOVE'}
                    </span>
                </div>

                {/* SVG 流水线 */}
                <div className="flex-1 flex items-center justify-center px-6">
                    <svg
                        className={`w-full max-w-[680px] h-auto transition-all duration-1000 ${mounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
                        viewBox="0 0 730 320"
                        preserveAspectRatio="xMidYMid meet"
                    >
                        <defs>
                            {/* 路径渐变 */}
                            <linearGradient id="pathGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#6366f1" />
                                <stop offset="25%" stopColor="#06b6d4" />
                                <stop offset="50%" stopColor="#f59e0b" />
                                <stop offset="75%" stopColor="#8b5cf6" />
                                <stop offset="100%" stopColor="#22c55e" />
                            </linearGradient>

                            {/* 光晕滤镜 */}
                            <filter id="nodeGlow" x="-100%" y="-100%" width="300%" height="300%">
                                <feGaussianBlur stdDeviation="6" result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>

                            <filter id="orbGlow" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="4" result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>

                            {/* 各节点径向渐变 */}
                            {NODES.map((node, idx) => (
                                <radialGradient key={`grad-${idx}`} id={`nodeGrad${idx}`}>
                                    <stop offset="0%" stopColor={node.lightColor} />
                                    <stop offset="100%" stopColor={node.color} />
                                </radialGradient>
                            ))}
                        </defs>

                        {/* 底层路径光晕 */}
                        <path
                            d={curvePath}
                            fill="none"
                            stroke="url(#pathGrad)"
                            strokeWidth="6"
                            opacity="0.08"
                            strokeLinecap="round"
                        />

                        {/* 主路径 - 流动虚线 */}
                        <path
                            d={curvePath}
                            fill="none"
                            stroke="url(#pathGrad)"
                            strokeWidth="2"
                            strokeDasharray="8,16"
                            opacity="0.4"
                            strokeLinecap="round"
                            style={{ animation: 'dashFlow 1.5s linear infinite' }}
                        />

                        {/* 路径上的流动光点 */}
                        <circle r="3" fill="#6366f1" opacity="0.6" filter="url(#orbGlow)">
                            <animateMotion dur="6s" repeatCount="indefinite" path={curvePath} />
                        </circle>
                        <circle r="2" fill="#06b6d4" opacity="0.5">
                            <animateMotion dur="6s" repeatCount="indefinite" path={curvePath} begin="2s" />
                        </circle>
                        <circle r="2" fill="#8b5cf6" opacity="0.4">
                            <animateMotion dur="6s" repeatCount="indefinite" path={curvePath} begin="4s" />
                        </circle>

                        {/* 处理节点 */}
                        {NODES.map((node, idx) => {
                            const pos = NODE_POSITIONS[idx];
                            const isActive = animState.currentNode === idx && animState.phase === 'processing';
                            const isPassed = idx < animState.currentNode ||
                                (idx === animState.currentNode && animState.phase === 'moving');

                            return (
                                <g key={idx}>
                                    {/* 脉冲环 (活跃时，三层波纹) */}
                                    {isActive && (
                                        <>
                                            <circle cx={pos.x} cy={pos.y} r="28" fill="none" stroke={node.color} strokeWidth="2" opacity="0.6">
                                                <animate attributeName="r" values="28;52" dur="1.5s" repeatCount="indefinite" />
                                                <animate attributeName="opacity" values="0.6;0" dur="1.5s" repeatCount="indefinite" />
                                            </circle>
                                            <circle cx={pos.x} cy={pos.y} r="28" fill="none" stroke={node.color} strokeWidth="1.5" opacity="0.4">
                                                <animate attributeName="r" values="28;52" dur="1.5s" repeatCount="indefinite" begin="0.5s" />
                                                <animate attributeName="opacity" values="0.4;0" dur="1.5s" repeatCount="indefinite" begin="0.5s" />
                                            </circle>
                                            <circle cx={pos.x} cy={pos.y} r="28" fill="none" stroke={node.lightColor} strokeWidth="1" opacity="0.3">
                                                <animate attributeName="r" values="28;52" dur="1.5s" repeatCount="indefinite" begin="1s" />
                                                <animate attributeName="opacity" values="0.3;0" dur="1.5s" repeatCount="indefinite" begin="1s" />
                                            </circle>
                                        </>
                                    )}

                                    {/* 节点外环光晕 */}
                                    <circle
                                        cx={pos.x} cy={pos.y} r="34"
                                        fill={isActive ? node.color : 'transparent'}
                                        opacity={isActive ? 0.12 : 0}
                                        style={{ transition: 'all 0.5s ease' }}
                                    />

                                    {/* 节点主体圆 */}
                                    <circle
                                        cx={pos.x} cy={pos.y} r="28"
                                        fill={isActive || isPassed ? `url(#nodeGrad${idx})` : '#0f172a'}
                                        stroke={node.color}
                                        strokeWidth={isActive ? 2.5 : 1.5}
                                        filter={isActive ? 'url(#nodeGlow)' : ''}
                                        style={{ transition: 'fill 0.4s, stroke-width 0.3s' }}
                                    />

                                    {/* 内环装饰 */}
                                    <circle
                                        cx={pos.x} cy={pos.y} r="22"
                                        fill="none"
                                        stroke={isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)'}
                                        strokeWidth="1"
                                        strokeDasharray="4,4"
                                        style={{ transition: 'stroke 0.3s' }}
                                    />

                                    {/* 节点图标 (SVG icon) */}
                                    <svg
                                        x={pos.x - 11} y={pos.y - 11}
                                        width="22" height="22"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke={isActive || isPassed ? 'white' : '#64748b'}
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d={NODE_ICON_PATHS[idx]} />
                                    </svg>

                                    {/* 节点标签 (上排节点标签在下方，下排节点标签在上方) */}
                                    <text
                                        x={pos.x}
                                        y={pos.y + (idx % 2 === 0 ? 52 : -44)}
                                        textAnchor="middle"
                                        fill={isActive ? '#fff' : isPassed ? '#94a3b8' : '#475569'}
                                        fontSize="13"
                                        fontWeight={isActive ? '600' : '400'}
                                        fontFamily="Inter, system-ui, sans-serif"
                                        style={{ transition: 'fill 0.3s' }}
                                    >
                                        {t(`pipeline.${PIPELINE_KEYS[idx]}` as any)}
                                    </text>
                                </g>
                            );
                        })}

                        {/* 移动的能量球 */}
                        <g filter="url(#orbGlow)">
                            {/* 外层光晕 */}
                            <circle cx={ticketPos.x} cy={ticketPos.y} r="16" fill={activeNode.color} opacity="0.12" />
                            {/* 中层光晕 */}
                            <circle cx={ticketPos.x} cy={ticketPos.y} r="10" fill={activeNode.color} opacity="0.3" />
                            {/* 核心 */}
                            <circle cx={ticketPos.x} cy={ticketPos.y} r="6" fill={activeNode.lightColor} />
                            {/* 高光点 */}
                            <circle cx={ticketPos.x - 2} cy={ticketPos.y - 2} r="2" fill="white" opacity="0.8" />
                        </g>

                        {/* 处理中闪烁环 */}
                        {animState.phase === 'processing' && (
                            <circle
                                cx={ticketPos.x} cy={ticketPos.y} r="8"
                                fill="none" stroke={activeNode.lightColor} strokeWidth="1.5"
                            >
                                <animate attributeName="r" values="8;18;8" dur="1s" repeatCount="indefinite" />
                                <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1s" repeatCount="indefinite" />
                            </circle>
                        )}
                    </svg>
                </div>

                {/* 品牌标识 */}
                <div className={`text-center pb-8 transition-all duration-700 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                        FD-AutoPilot
                    </h2>
                    <p className="text-slate-500 text-sm mt-1">{t('login.brandSubtitle')}</p>
                </div>
            </div>

            {/* ===== 分割线 ===== */}
            <div className="w-px relative flex-shrink-0">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
            </div>

            {/* ===== 右侧面板 - 登录表单 ===== */}
            <div className="flex-1 flex items-center justify-center relative overflow-hidden bg-slate-900/50">
                {/* 右侧微弱背景光 */}
                <div className="absolute top-1/4 right-1/4 w-[300px] h-[300px] rounded-full blur-[100px] opacity-[0.05] pointer-events-none" style={{ background: '#6366f1' }} />

                <div className={`w-full max-w-sm px-8 transition-all duration-700 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                    {/* Logo */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-cyan-500 shadow-2xl shadow-indigo-500/25 mb-4">
                            <span className="text-white text-xl font-black tracking-tight">FD</span>
                        </div>
                        <h1 className="text-2xl font-bold text-white mb-1">{t('login.title')}</h1>
                        <p className="text-slate-500 text-sm">{t('login.subtitle')}</p>
                    </div>

                    {/* 玻璃质感卡片 */}
                    <div className="backdrop-blur-2xl bg-white/[0.04] rounded-3xl border border-white/[0.08] p-7 shadow-2xl relative overflow-hidden">
                        {/* 顶部高光线 */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2/3 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

                        <form onSubmit={handleSubmit} className="space-y-5">
                            {/* 错误提示 */}
                            {displayError && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-center gap-2.5">
                                    <div className="flex-shrink-0 w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center">
                                        <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
                                        </svg>
                                    </div>
                                    <span className="text-red-300 text-sm">{displayError}</span>
                                </div>
                            )}

                            {/* 用户名输入 */}
                            <div className="space-y-1.5">
                                <label className="text-slate-400 text-xs font-medium pl-1 block">{t('login.username')}</label>
                                <div className={`relative group ${focusedField === 'username' ? 'z-10' : ''}`}>
                                    <div className={`absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl opacity-0 blur transition-opacity duration-300 ${focusedField === 'username' ? 'opacity-50' : 'group-hover:opacity-20'}`} />
                                    <div className="relative flex items-center">
                                        <div className="absolute left-3.5 text-slate-500">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                            </svg>
                                        </div>
                                        <input
                                            type="text"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            onFocus={() => setFocusedField('username')}
                                            onBlur={() => setFocusedField(null)}
                                            placeholder={t('login.usernamePlaceholder')}
                                            className="relative w-full pl-10 pr-4 py-3 bg-slate-900/60 border border-white/10 rounded-xl text-white text-sm placeholder-slate-600 focus:outline-none focus:border-transparent transition-all duration-300"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* 密码输入 */}
                            <div className="space-y-1.5">
                                <label className="text-slate-400 text-xs font-medium pl-1 block">{t('login.password')}</label>
                                <div className={`relative group ${focusedField === 'password' ? 'z-10' : ''}`}>
                                    <div className={`absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl opacity-0 blur transition-opacity duration-300 ${focusedField === 'password' ? 'opacity-50' : 'group-hover:opacity-20'}`} />
                                    <div className="relative flex items-center">
                                        <div className="absolute left-3.5 text-slate-500">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                            </svg>
                                        </div>
                                        <input
                                            type="password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            onFocus={() => setFocusedField('password')}
                                            onBlur={() => setFocusedField(null)}
                                            placeholder={t('login.passwordPlaceholder')}
                                            className="relative w-full pl-10 pr-4 py-3 bg-slate-900/60 border border-white/10 rounded-xl text-white text-sm placeholder-slate-600 focus:outline-none focus:border-transparent transition-all duration-300"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* 登录按钮 */}
                            <button
                                type="submit"
                                disabled={isLoading || !username.trim() || !password.trim()}
                                className="w-full py-3 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-[length:200%_100%] hover:from-indigo-500 hover:via-purple-500 hover:to-indigo-500 text-white font-semibold text-sm rounded-xl transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 flex items-center justify-center gap-2 relative overflow-hidden group mt-1"
                            >
                                {/* Shimmer 光效 */}
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                    <div
                                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                                        style={{ animation: 'shimmer 2s linear infinite' }}
                                    />
                                </div>
                                {isLoading ? (
                                    <>
                                        <svg className="animate-spin w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        <span>{t('login.loggingIn')}</span>
                                    </>
                                ) : (
                                    <>
                                        <span>{t('login.submitButton')}</span>
                                        <svg className="w-4 h-4 text-white/80 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                        </svg>
                                    </>
                                )}
                            </button>
                        </form>

                        {/* 服务器配置 */}
                        <div className="mt-5 pt-5 border-t border-white/[0.06]">
                            <button
                                type="button"
                                onClick={() => setShowServerConfig(!showServerConfig)}
                                className="w-full flex items-center justify-center gap-1.5 text-slate-500 hover:text-slate-300 text-[11px] transition-colors"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                {t('login.serverConfig')}
                                <svg className={`w-3 h-3 transition-transform duration-300 ${showServerConfig ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {showServerConfig && (
                                <div className="mt-3 space-y-2">
                                    <label className="text-slate-600 text-[10px] font-medium uppercase tracking-wider block">Server URL</label>
                                    <input
                                        type="text"
                                        value={serverUrl}
                                        onChange={(e) => {
                                            setServerUrlLocal(e.target.value);
                                            setServerBaseUrl(e.target.value);
                                        }}
                                        className="w-full px-3 py-2 bg-slate-900/60 border border-white/10 rounded-lg text-slate-300 text-xs font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                                        placeholder="http://localhost:9988"
                                    />
                                </div>
                            )}
                        </div>

                        {/* 忘记密码 */}
                        <div className="mt-4 text-center">
                            <button
                                type="button"
                                onClick={() => setShowForgotPassword(!showForgotPassword)}
                                className="text-slate-500 hover:text-indigo-400 text-xs transition-colors"
                            >
                                {t('login.forgotPassword')}
                            </button>
                        </div>

                        {showForgotPassword && (
                            <div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                                <div className="flex items-start gap-2">
                                    <svg className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="text-amber-300/90 text-xs leading-relaxed">
                                        {t('login.forgotPasswordHint')}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* 注册链接 */}
                        <div className="mt-4 text-center">
                            <button onClick={onSwitchToRegister} className="text-slate-500 hover:text-white text-xs transition-colors">
                                {t('login.noAccount')} <span className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('login.register')}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AuthLoginTab;
