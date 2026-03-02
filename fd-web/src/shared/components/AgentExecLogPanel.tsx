/**
 * Agent 执行日志 -- 可复用面板组件
 *
 * 通过 Bridge API 查询 Rust 客户端存储的 Agent 执行日志，
 * 支持状态筛选、分页、展开详情、日志配置管理。
 * Bridge 不可用时显示优雅降级提示。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { execLogApi, type ExecLogEntry } from '../services/execLogApi';

// ─── 类型 ──────────────────────────────────────────────────

interface AgentExecLogPanelProps {
    agentCode: string;
    agentName?: string;
    className?: string;
}

type StatusFilter = '' | 'success' | 'failed' | 'timeout';

// ─── 常量 ──────────────────────────────────────────────────

const PAGE_SIZE = 20;

const STATUS_CONFIG: Record<ExecLogEntry['status'], {
    dot: string;
    badge: string;
    label: string;
}> = {
    running: {
        dot: 'bg-blue-400 shadow-blue-400/50',
        badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
        label: '运行中',
    },
    success: {
        dot: 'bg-emerald-400 shadow-emerald-400/50',
        badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        label: '成功',
    },
    failed: {
        dot: 'bg-red-400 shadow-red-400/50',
        badge: 'bg-red-500/20 text-red-300 border-red-500/30',
        label: '失败',
    },
    timeout: {
        dot: 'bg-amber-400 shadow-amber-400/50',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        label: '超时',
    },
};

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
    { value: '', label: '全部' },
    { value: 'success', label: '成功' },
    { value: 'failed', label: '失败' },
    { value: 'timeout', label: '超时' },
];

// ─── 工具函数 ───────────────────────────────────────────────

function formatTime(isoStr: string): string {
    try {
        const d = new Date(isoStr);
        return d.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    } catch {
        return isoStr;
    }
}

function formatDuration(ms: number | null): string {
    if (ms === null || ms === undefined) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const min = Math.floor(ms / 60000);
    const sec = Math.round((ms % 60000) / 1000);
    return `${min}m ${sec}s`;
}

function getInputSummary(entry: ExecLogEntry): string {
    if (!entry.inputParams) return '-';
    try {
        const parsed = JSON.parse(entry.inputParams);
        // 优先显示 metadata 中的结构化摘要
        if (parsed.metadata) {
            const m = parsed.metadata;
            const parts: string[] = [];
            if (m.ticketId) parts.push(`#${m.ticketId}`);
            if (m.subject) parts.push(m.subject.length > 25 ? m.subject.substring(0, 25) + '...' : m.subject);
            if (m.targetLangName) parts.push(`→${m.targetLangName}`);
            if (m.conversationCount > 0) parts.push(`${m.conversationCount}条对话`);
            return parts.join(' | ') || `${Object.keys(parsed).length} params`;
        }
        // 兼容旧日志（无 metadata）
        if (parsed.ticketId) {
            return `#${parsed.ticketId} ${parsed.subject || ''}`.trim();
        }
        if (typeof parsed === 'string') {
            return `prompt: ${parsed.length} chars`;
        }
        if (parsed.promptLength) {
            return `prompt: ${parsed.promptLength} chars`;
        }
        const keys = Object.keys(parsed);
        return keys.length > 0 ? `${keys.length} params` : '-';
    } catch {
        return `${entry.inputParams.length} chars`;
    }
}

function tryFormatJson(raw: string): string {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        // 尝试去除 markdown 代码围栏后再解析
        const stripped = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```\s*$/, '');
        try {
            return JSON.stringify(JSON.parse(stripped), null, 2);
        } catch {
            return raw;
        }
    }
}

/** 从 inputParams 中提取 metadata 和 promptFull 分区展示 */
function parseInputParams(raw: string): { metadata: Record<string, any> | null; promptFull: string | null; rest: string } {
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return { metadata: null, promptFull: null, rest: raw };

        const metadata = parsed.metadata || null;
        const promptFull = parsed.promptFull || null;

        // 剩余字段（排除 metadata, promptFull）
        const restObj: Record<string, any> = {};
        for (const [k, v] of Object.entries(parsed)) {
            if (k !== 'metadata' && k !== 'promptFull') {
                restObj[k] = v;
            }
        }
        return { metadata, promptFull, rest: JSON.stringify(restObj, null, 2) };
    } catch {
        return { metadata: null, promptFull: null, rest: raw };
    }
}

// ─── 日志行组件 ─────────────────────────────────────────────

const LogRow: React.FC<{
    entry: ExecLogEntry;
    isExpanded: boolean;
    onToggle: () => void;
}> = ({ entry, isExpanded, onToggle }) => {
    const cfg = STATUS_CONFIG[entry.status];

    return (
        <div className="group">
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-700/40 transition-colors text-left"
            >
                {/* 状态圆点 */}
                <span className={`w-2 h-2 rounded-full shrink-0 shadow-sm ${cfg.dot} ${entry.status === 'running' ? 'animate-pulse' : ''}`} />

                {/* 时间 */}
                <span className="text-xs text-slate-500 font-mono w-[120px] shrink-0">
                    {formatTime(entry.createdAt)}
                </span>

                {/* 状态 badge */}
                <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${cfg.badge}`}>
                    {cfg.label}
                </span>

                {/* 耗时 */}
                <span className="text-xs text-slate-500 font-mono w-[56px] shrink-0">
                    {formatDuration(entry.durationMs)}
                </span>

                {/* 输入摘要 */}
                <span className="text-xs text-slate-400 flex-1 truncate">
                    {getInputSummary(entry)}
                </span>

                {/* 展开箭头 */}
                <svg
                    className={`w-4 h-4 text-slate-500 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* 展开详情 */}
            {isExpanded && (
                <div className="ml-3 pl-4 border-l-2 border-slate-700/50 mb-2">
                    <div className="bg-slate-800/60 rounded-lg p-4 mt-1 space-y-3 text-sm">
                        {/* 基本信息 */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                            <DetailItem label="Agent" value={entry.agentCode} />
                            <DetailItem label="状态" value={cfg.label} />
                            <DetailItem label="时间" value={entry.createdAt} />
                            <DetailItem label="耗时" value={formatDuration(entry.durationMs)} />
                            {entry.refType && <DetailItem label="关联类型" value={entry.refType} />}
                            {entry.refId && <DetailItem label="关联 ID" value={entry.refId} />}
                        </div>

                        {/* 命令 */}
                        {entry.command && (
                            <div className="pt-2 border-t border-slate-700/50">
                                <p className="text-xs text-slate-500 mb-1.5">命令</p>
                                <code className="text-xs text-slate-300 bg-slate-900/50 rounded px-2 py-1 block font-mono">
                                    {entry.command}
                                </code>
                            </div>
                        )}

                        {/* 输入参数（分区展示） */}
                        {entry.inputParams && (() => {
                            const { metadata, promptFull, rest } = parseInputParams(entry.inputParams);
                            return (
                                <>
                                    {/* 元数据（结构化入参） */}
                                    {metadata && (
                                        <div className="pt-2 border-t border-slate-700/50">
                                            <p className="text-xs text-slate-500 mb-1.5">运行时入参</p>
                                            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 bg-slate-900/50 rounded p-2.5">
                                                {Object.entries(metadata).filter(([k]) => k !== 'refType' && k !== 'refId').map(([k, v]) => (
                                                    <DetailItem key={k} label={k} value={String(v ?? '-')} />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* 概要参数（models, promptLength 等） */}
                                    <div className="pt-2 border-t border-slate-700/50">
                                        <p className="text-xs text-slate-500 mb-1.5">请求参数</p>
                                        <pre className="text-xs text-slate-400 bg-slate-900/50 rounded p-2.5 overflow-x-auto max-h-[120px] overflow-y-auto font-mono whitespace-pre-wrap break-all">
                                            {rest}
                                        </pre>
                                    </div>

                                    {/* 完整 Prompt（可折叠） */}
                                    {promptFull && (
                                        <CollapsibleSection title="完整 Prompt" defaultCollapsed>
                                            <pre className="text-xs text-slate-400 bg-slate-900/50 rounded p-2.5 overflow-x-auto max-h-[300px] overflow-y-auto font-mono whitespace-pre-wrap break-all">
                                                {promptFull}
                                            </pre>
                                        </CollapsibleSection>
                                    )}
                                </>
                            );
                        })()}

                        {/* 输出 (stdout) */}
                        {entry.stdout && (
                            <div className="pt-2 border-t border-slate-700/50">
                                <p className="text-xs text-slate-500 mb-1.5">输出 (stdout)</p>
                                <pre className="text-xs text-slate-400 bg-slate-900/50 rounded p-2.5 overflow-x-auto max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap break-all">
                                    {tryFormatJson(entry.stdout)}
                                </pre>
                            </div>
                        )}

                        {/* 错误 (stderr) */}
                        {entry.stderr && (
                            <div className="pt-2 border-t border-slate-700/50">
                                <p className="text-xs text-amber-400 mb-1.5">错误输出 (stderr)</p>
                                <pre className="text-xs text-amber-300/80 bg-amber-950/20 rounded p-2.5 overflow-x-auto max-h-[150px] overflow-y-auto font-mono whitespace-pre-wrap break-all border border-amber-500/20">
                                    {entry.stderr}
                                </pre>
                            </div>
                        )}

                        {/* 错误信息 */}
                        {entry.errorMsg && (
                            <div className="pt-2 border-t border-slate-700/50">
                                <p className="text-xs text-red-400 mb-1.5">错误信息</p>
                                <pre className="text-xs text-red-300/80 bg-red-950/30 rounded p-2.5 overflow-x-auto max-h-[150px] overflow-y-auto font-mono whitespace-pre-wrap break-all border border-red-500/20">
                                    {entry.errorMsg}
                                </pre>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

/** 详情字段 */
const DetailItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="flex items-baseline gap-2">
        <span className="text-xs text-slate-500 shrink-0">{label}:</span>
        <span className="text-xs text-slate-300 truncate font-mono" title={value}>{value}</span>
    </div>
);

/** 可折叠区域 */
const CollapsibleSection: React.FC<{
    title: string;
    defaultCollapsed?: boolean;
    children: React.ReactNode;
}> = ({ title, defaultCollapsed = false, children }) => {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    return (
        <div className="pt-2 border-t border-slate-700/50">
            <button
                onClick={() => setCollapsed(!collapsed)}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 mb-1.5 transition-colors"
            >
                <svg
                    className={`w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                {title}
            </button>
            {!collapsed && children}
        </div>
    );
};

// ─── 配置弹窗 ───────────────────────────────────────────────

const ConfigModal: React.FC<{
    agentCode: string;
    agentName?: string;
    onClose: () => void;
}> = ({ agentCode, agentName, onClose }) => {
    const [retentionDays, setRetentionDays] = useState(30);
    const [enabled, setEnabled] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [cleaning, setCleaning] = useState(false);
    const [cleanResult, setCleanResult] = useState<number | null>(null);

    useEffect(() => {
        let mounted = true;
        execLogApi.getConfig(agentCode).then(configs => {
            if (!mounted) return;
            if (configs.length > 0) {
                setRetentionDays(configs[0].retentionDays);
                setEnabled(configs[0].enabled);
            }
            setLoading(false);
        });
        return () => { mounted = false; };
    }, [agentCode]);

    const handleSave = async () => {
        setSaving(true);
        await execLogApi.setConfig({
            agentCode,
            retentionDays,
            enabled,
        });
        setSaving(false);
        onClose();
    };

    const handleCleanup = async () => {
        setCleaning(true);
        const result = await execLogApi.cleanup(agentCode);
        setCleanResult(result.deleted);
        setCleaning(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div
                className="bg-slate-800 border border-slate-700 rounded-lg w-[400px] shadow-xl"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                    <h3 className="text-slate-200 font-medium text-sm">
                        日志配置 {agentName ? `- ${agentName}` : ''}
                    </h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg">&times;</button>
                </div>

                <div className="px-5 py-4 space-y-4">
                    {loading ? (
                        <div className="flex items-center justify-center py-4">
                            <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-600 border-t-blue-400" />
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="text-xs text-slate-400 mb-1.5 block">日志保留天数</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        value={retentionDays}
                                        onChange={e => setRetentionDays(Math.max(1, parseInt(e.target.value) || 1))}
                                        min={1}
                                        max={365}
                                        className="w-24 bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                                    />
                                    <span className="text-xs text-slate-500">天</span>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400 mb-1.5 block">启用日志记录</label>
                                <button
                                    onClick={() => setEnabled(!enabled)}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                        enabled ? 'bg-blue-600' : 'bg-slate-600'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                                            enabled ? 'translate-x-4' : 'translate-x-0.5'
                                        }`}
                                    />
                                </button>
                            </div>

                            {cleanResult !== null && (
                                <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-2">
                                    已清理 {cleanResult} 条过期日志
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700">
                    <button
                        onClick={handleCleanup}
                        disabled={loading || cleaning}
                        className="text-xs px-3 py-1.5 rounded bg-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-600 transition-colors disabled:opacity-40"
                    >
                        {cleaning ? '清理中...' : '手动清理过期日志'}
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="text-xs px-3 py-1.5 text-slate-400 hover:text-slate-300"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={loading || saving}
                            className="text-xs px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
                        >
                            {saving ? '保存中...' : '保存'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── 主组件 ──────────────────────────────────────────────────

const AgentExecLogPanel: React.FC<AgentExecLogPanelProps> = ({
    agentCode,
    agentName,
    className = '',
}) => {
    const [available, setAvailable] = useState<boolean | null>(null);
    const [entries, setEntries] = useState<ExecLogEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
    const [page, setPage] = useState(0);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [showConfig, setShowConfig] = useState(false);

    const mountedRef = useRef(true);

    // 检测 Bridge 可用性
    useEffect(() => {
        mountedRef.current = true;
        execLogApi.checkAvailable().then(ok => {
            if (mountedRef.current) setAvailable(ok);
        });
        return () => { mountedRef.current = false; };
    }, []);

    // 查询数据
    const fetchLogs = useCallback(async () => {
        if (available === false) return;
        setLoading(true);
        try {
            const result = await execLogApi.query(agentCode, {
                status: statusFilter || undefined,
                limit: PAGE_SIZE,
                offset: page * PAGE_SIZE,
            });
            if (mountedRef.current) {
                setEntries(result.items);
                setTotal(result.total);
            }
        } catch (e) {
            console.error('[AgentExecLogPanel] Failed to fetch logs:', e);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [agentCode, statusFilter, page, available]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    // 筛选变化时回到第一页
    useEffect(() => { setPage(0); }, [statusFilter]);

    // agentCode 变化时重置状态
    useEffect(() => {
        setStatusFilter('');
        setPage(0);
        setExpandedId(null);
    }, [agentCode]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    // ─── Bridge 不可用 ─────────────────────────────────────
    if (available === false) {
        return (
            <div className={`bg-slate-800/50 rounded-lg p-6 ${className}`}>
                <div className="flex flex-col items-center justify-center text-slate-500 py-4">
                    <svg className="w-10 h-10 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3" />
                    </svg>
                    <p className="text-sm font-medium">客户端未连接</p>
                    <p className="text-xs mt-1 text-slate-600">无法查看执行日志，请确保 fd-bridge 服务正在运行</p>
                </div>
            </div>
        );
    }

    // ─── 加载检测中 ────────────────────────────────────────
    if (available === null) {
        return (
            <div className={`bg-slate-800/50 rounded-lg p-6 ${className}`}>
                <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-600 border-t-blue-400" />
                </div>
            </div>
        );
    }

    // ─── 主界面 ────────────────────────────────────────────
    return (
        <div className={`bg-slate-800/50 rounded-lg flex flex-col overflow-hidden ${className}`}>
            {/* 头部 */}
            <div className="px-4 pt-3 pb-2 border-b border-slate-700/50">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-slate-200">
                        执行日志
                        {agentName && <span className="text-slate-500 ml-1.5">- {agentName}</span>}
                    </h3>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={fetchLogs}
                            className="p-1.5 rounded hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 transition-colors"
                            title="刷新"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                        <button
                            onClick={() => setShowConfig(true)}
                            className="p-1.5 rounded hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 transition-colors"
                            title="日志配置"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* 状态筛选 tabs */}
                <div className="flex items-center gap-1">
                    {STATUS_TABS.map(tab => (
                        <button
                            key={tab.value}
                            onClick={() => setStatusFilter(tab.value)}
                            className={`text-xs px-2.5 py-1 rounded transition-colors ${
                                statusFilter === tab.value
                                    ? 'bg-blue-500/20 text-blue-300 font-medium'
                                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                    <span className="text-xs text-slate-600 ml-auto">
                        共 {total} 条
                    </span>
                </div>
            </div>

            {/* 日志列表 */}
            <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0" style={{ maxHeight: '400px' }}>
                {loading && entries.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-600 border-t-blue-400" />
                    </div>
                ) : entries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                        <svg className="w-10 h-10 mb-2 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-xs">暂无执行日志</p>
                    </div>
                ) : (
                    <div className="space-y-0.5">
                        {entries.map(entry => (
                            <LogRow
                                key={entry.id}
                                entry={entry}
                                isExpanded={expandedId === entry.id}
                                onToggle={() => setExpandedId(prev => prev === entry.id ? null : entry.id)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 px-4 py-2 border-t border-slate-700/50">
                    <button
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="text-xs px-2.5 py-1 rounded bg-slate-700/50 text-slate-400 hover:text-slate-200 border border-slate-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        上一页
                    </button>
                    <span className="text-xs text-slate-500">
                        第 {page + 1}/{totalPages} 页
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        className="text-xs px-2.5 py-1 rounded bg-slate-700/50 text-slate-400 hover:text-slate-200 border border-slate-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        下一页
                    </button>
                    <span className="text-xs text-slate-600 ml-2">每页 {PAGE_SIZE} 条</span>
                </div>
            )}

            {/* 配置弹窗 */}
            {showConfig && (
                <ConfigModal
                    agentCode={agentCode}
                    agentName={agentName}
                    onClose={() => setShowConfig(false)}
                />
            )}
        </div>
    );
};

export default AgentExecLogPanel;
