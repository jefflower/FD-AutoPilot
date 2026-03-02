/**
 * Agent 执行历史 -- 时间线可视化页面
 *
 * 展示本地存储的 Agent 执行记录（IndexedDB），
 * 支持按 Agent / 状态 / 时间范围筛选，点击展开详情。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    getRecords,
    getDistinctAgentCodes,
    clearAllRecords,
    clearOldRecords,
    type AgentExecutionRecord,
    type QueryOptions,
} from '../../../shared/services/executionHistory';

// ─── 常量 ──────────────────────────────────────────────────

const PAGE_SIZE = 50;

type TimeRange = 'today' | 'week' | 'month' | 'all';
type StatusFilter = '' | 'running' | 'completed' | 'failed' | 'timeout';

/** 状态颜色映射 */
const STATUS_CONFIG: Record<AgentExecutionRecord['status'], {
    dot: string;
    badge: string;
    label: string;
    labelEn: string;
}> = {
    running: {
        dot: 'bg-amber-400 shadow-amber-400/50',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        label: '运行中',
        labelEn: 'Running',
    },
    completed: {
        dot: 'bg-emerald-400 shadow-emerald-400/50',
        badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        label: '成功',
        labelEn: 'Completed',
    },
    failed: {
        dot: 'bg-red-400 shadow-red-400/50',
        badge: 'bg-red-500/20 text-red-300 border-red-500/30',
        label: '失败',
        labelEn: 'Failed',
    },
    timeout: {
        dot: 'bg-orange-400 shadow-orange-400/50',
        badge: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
        label: '超时',
        labelEn: 'Timeout',
    },
};

// ─── 工具函数 ───────────────────────────────────────────────

function getTimeRangeStart(range: TimeRange): number | undefined {
    const now = new Date();
    switch (range) {
        case 'today': {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            return start.getTime();
        }
        case 'week':
            return now.getTime() - 7 * 24 * 60 * 60 * 1000;
        case 'month':
            return now.getTime() - 30 * 24 * 60 * 60 * 1000;
        case 'all':
            return undefined;
    }
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number | undefined): string {
    if (ms === undefined || ms === null) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const min = Math.floor(ms / 60000);
    const sec = Math.round((ms % 60000) / 1000);
    return `${min}m ${sec}s`;
}

function getDateKey(ts: number): string {
    const now = new Date();
    const d = new Date(ts);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 24 * 60 * 60 * 1000;

    if (ts >= today) return 'today';
    if (ts >= yesterday) return 'yesterday';
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function getDateLabel(key: string, t: (k: string) => string): string {
    if (key === 'today') return t('execution.today');
    if (key === 'yesterday') return t('execution.yesterday');
    return key;
}

/** 按日期分组记录 */
function groupByDate(records: AgentExecutionRecord[]): Array<{ dateKey: string; records: AgentExecutionRecord[] }> {
    const groups = new Map<string, AgentExecutionRecord[]>();
    for (const r of records) {
        const key = getDateKey(r.startTime);
        const existing = groups.get(key);
        if (existing) {
            existing.push(r);
        } else {
            groups.set(key, [r]);
        }
    }
    return Array.from(groups.entries()).map(([dateKey, records]) => ({ dateKey, records }));
}

// ─── 组件 ───────────────────────────────────────────────────

/** 单条记录行 */
const RecordRow: React.FC<{
    record: AgentExecutionRecord;
    isExpanded: boolean;
    onToggle: () => void;
    t: (k: string) => string;
}> = ({ record, isExpanded, onToggle, t }) => {
    const cfg = STATUS_CONFIG[record.status];

    return (
        <div className="group">
            {/* 主行 */}
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-700/40 transition-colors text-left"
            >
                {/* 状态圆点 */}
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-sm ${cfg.dot} ${record.status === 'running' ? 'animate-pulse' : ''}`} />

                {/* 时间 */}
                <span className="text-xs text-slate-500 font-mono w-[68px] shrink-0">
                    {formatTime(record.startTime)}
                </span>

                {/* Agent 名称 */}
                <span className="text-sm font-medium text-slate-300 w-[160px] shrink-0 truncate" title={record.agentCode}>
                    {record.agentName || record.agentCode}
                </span>

                {/* 输入摘要 */}
                <span className="text-sm text-slate-400 flex-1 truncate">
                    {record.inputSummary || '-'}
                </span>

                {/* 状态 badge */}
                <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${cfg.badge}`}>
                    {cfg.label}
                </span>

                {/* 耗时 */}
                <span className="text-xs text-slate-500 font-mono w-[64px] text-right shrink-0">
                    {formatDuration(record.durationMs)}
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
                <div className="ml-[14px] pl-6 border-l-2 border-slate-700/50 mb-2">
                    <div className="bg-slate-800/60 rounded-lg p-4 mt-1 space-y-3 text-sm">
                        {/* 基本信息 */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                            <DetailItem label={t('execution.agentCode')} value={record.agentCode} />
                            <DetailItem label={t('execution.capability')} value={record.capability} />
                            <DetailItem label={t('execution.startTime')} value={new Date(record.startTime).toLocaleString('zh-CN')} />
                            <DetailItem label={t('execution.endTime')} value={record.endTime ? new Date(record.endTime).toLocaleString('zh-CN') : '-'} />
                            <DetailItem label={t('execution.duration')} value={formatDuration(record.durationMs)} />
                            <DetailItem label={t('execution.clientId')} value={record.clientId} mono />
                            {record.ticketId && (
                                <DetailItem label="Ticket ID" value={`#${record.ticketId}`} />
                            )}
                        </div>

                        {/* 路由信息 */}
                        {record.routeInfo && (
                            <div className="pt-2 border-t border-slate-700/50">
                                <p className="text-xs text-slate-500 mb-1.5">{t('execution.routeInfo')}</p>
                                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                                    <span className="px-2 py-0.5 bg-slate-700/50 rounded">{record.routeInfo.requiredCapability}</span>
                                    <svg className="w-3.5 h-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                    </svg>
                                    <span className="px-2 py-0.5 bg-slate-700/50 rounded">{record.routeInfo.resolvedAgentCode}</span>
                                    <svg className="w-3.5 h-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                    </svg>
                                    <span className="px-2 py-0.5 bg-slate-700/50 rounded">{record.routeInfo.resolvedClientId.slice(0, 8)}...</span>
                                </div>
                            </div>
                        )}

                        {/* 输入 */}
                        {record.fullInput && (
                            <div className="pt-2 border-t border-slate-700/50">
                                <p className="text-xs text-slate-500 mb-1.5">{t('execution.input')}</p>
                                <pre className="text-xs text-slate-400 bg-slate-900/50 rounded p-2.5 overflow-x-auto max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap break-all">
                                    {tryFormatJson(record.fullInput)}
                                </pre>
                            </div>
                        )}

                        {/* 输出 */}
                        {record.outputSummary && (
                            <div className="pt-2 border-t border-slate-700/50">
                                <p className="text-xs text-slate-500 mb-1.5">{t('execution.output')}</p>
                                <pre className="text-xs text-slate-400 bg-slate-900/50 rounded p-2.5 overflow-x-auto max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap break-all">
                                    {record.fullOutput || record.outputSummary}
                                </pre>
                            </div>
                        )}

                        {/* 错误信息 */}
                        {record.errorMessage && (
                            <div className="pt-2 border-t border-slate-700/50">
                                <p className="text-xs text-red-400 mb-1.5">{t('execution.error')}</p>
                                <pre className="text-xs text-red-300/80 bg-red-950/30 rounded p-2.5 overflow-x-auto max-h-[150px] overflow-y-auto font-mono whitespace-pre-wrap break-all border border-red-500/20">
                                    {record.errorMessage}
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
const DetailItem: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
    <div className="flex items-baseline gap-2">
        <span className="text-xs text-slate-500 shrink-0">{label}:</span>
        <span className={`text-xs text-slate-300 truncate ${mono ? 'font-mono' : ''}`} title={value}>{value}</span>
    </div>
);

/** 尝试格式化 JSON 字符串 */
function tryFormatJson(raw: string): string {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
}

// ─── 主页面 ─────────────────────────────────────────────────

const AgentExecutionTab: React.FC = () => {
    const { t } = useTranslation(['taskAdmin', 'common']);

    const [records, setRecords] = useState<AgentExecutionRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [agentCodes, setAgentCodes] = useState<string[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // 筛选
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
    const [agentFilter, setAgentFilter] = useState('');
    const [timeRange, setTimeRange] = useState<TimeRange>('today');
    const [page, setPage] = useState(0);

    // 自动刷新定时器
    const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchRecords = useCallback(async () => {
        setLoading(true);
        try {
            const opts: QueryOptions = {
                offset: page * PAGE_SIZE,
                limit: PAGE_SIZE,
            };
            if (statusFilter) opts.status = statusFilter as AgentExecutionRecord['status'];
            if (agentFilter) opts.agentCode = agentFilter;
            const rangeStart = getTimeRangeStart(timeRange);
            if (rangeStart) opts.startTimeFrom = rangeStart;

            const result = await getRecords(opts);
            setRecords(result.records);
            setTotal(result.total);
        } catch (e) {
            console.error('[AgentExecution] Failed to fetch records:', e);
        } finally {
            setLoading(false);
        }
    }, [page, statusFilter, agentFilter, timeRange]);

    const fetchAgentCodes = useCallback(async () => {
        try {
            const codes = await getDistinctAgentCodes();
            setAgentCodes(codes);
        } catch { /* ignore */ }
    }, []);

    // 初次加载 + 筛选变化时刷新
    useEffect(() => {
        fetchRecords();
    }, [fetchRecords]);

    useEffect(() => {
        fetchAgentCodes();
    }, [fetchAgentCodes]);

    // 自动刷新（每 5 秒）
    useEffect(() => {
        refreshTimerRef.current = setInterval(fetchRecords, 5000);
        return () => {
            if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
        };
    }, [fetchRecords]);

    // 筛选变化时回到第一页
    useEffect(() => { setPage(0); }, [statusFilter, agentFilter, timeRange]);

    const handleClearAll = async () => {
        if (!window.confirm(t('execution.confirmClear', { ns: 'taskAdmin' }))) return;
        await clearAllRecords();
        fetchRecords();
        fetchAgentCodes();
    };

    const handleClearOld = async () => {
        const removed = await clearOldRecords(30);
        if (removed > 0) {
            fetchRecords();
            fetchAgentCodes();
        }
    };

    /** 导出当前筛选结果为 CSV 文件 */
    const handleExportCsv = useCallback(async () => {
        try {
            const opts: QueryOptions = { offset: 0, limit: 10000 };
            if (statusFilter) opts.status = statusFilter as AgentExecutionRecord['status'];
            if (agentFilter) opts.agentCode = agentFilter;
            const rangeStart = getTimeRangeStart(timeRange);
            if (rangeStart) opts.startTimeFrom = rangeStart;

            const result = await getRecords(opts);
            if (result.records.length === 0) return;

            const BOM = '\uFEFF';
            const headers = ['ID', 'Agent Code', 'Agent Name', 'Capability', 'Status', 'Duration (ms)', 'Start Time', 'End Time', 'Client ID', 'Ticket ID', 'Input Summary', 'Error'];
            const esc = (v: string | number | undefined | null) => {
                if (v === undefined || v === null) return '';
                const s = String(v).replace(/"/g, '""');
                return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
            };

            const rows = result.records.map(r => [
                r.id, r.agentCode, r.agentName, r.capability, r.status,
                r.durationMs ?? '', new Date(r.startTime).toISOString(),
                r.endTime ? new Date(r.endTime).toISOString() : '',
                r.clientId, r.ticketId ?? '', r.inputSummary, r.errorMessage ?? '',
            ].map(esc).join(','));

            const csv = BOM + headers.join(',') + '\n' + rows.join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `agent-executions-local-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[AgentExecution] Export failed:', e);
        }
    }, [statusFilter, agentFilter, timeRange]);

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const groups = groupByDate(records);

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-900">
            {/* 头部 */}
            <div className="shrink-0 px-6 pt-5 pb-4 border-b border-slate-700/50">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-lg font-semibold text-slate-100">{t('execution.title', { ns: 'taskAdmin' })}</h1>
                        <p className="text-xs text-slate-500 mt-0.5">{t('execution.description', { ns: 'taskAdmin' })}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">
                            {t('common:label.total', { count: total })}
                        </span>
                        <button
                            onClick={handleExportCsv}
                            disabled={total === 0}
                            className="text-xs px-2.5 py-1.5 rounded-md bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700/80 transition-colors border border-slate-700/50 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={t('execution.exportCsv', { ns: 'taskAdmin' })}
                        >
                            <span className="flex items-center gap-1">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                CSV
                            </span>
                        </button>
                        <button
                            onClick={handleClearOld}
                            className="text-xs px-2.5 py-1.5 rounded-md bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700/80 transition-colors border border-slate-700/50"
                        >
                            {t('execution.clearOld', { ns: 'taskAdmin' })}
                        </button>
                        <button
                            onClick={handleClearAll}
                            className="text-xs px-2.5 py-1.5 rounded-md bg-red-900/30 text-red-400 hover:text-red-300 hover:bg-red-900/50 transition-colors border border-red-500/20"
                        >
                            {t('execution.clearAll', { ns: 'taskAdmin' })}
                        </button>
                        <button
                            onClick={fetchRecords}
                            className="text-xs px-2.5 py-1.5 rounded-md bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700/80 transition-colors border border-slate-700/50"
                        >
                            {t('common:button.refresh')}
                        </button>
                    </div>
                </div>

                {/* 筛选栏 */}
                <div className="flex items-center gap-3 flex-wrap">
                    {/* 状态筛选 */}
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                        className="text-xs bg-slate-800 text-slate-300 border border-slate-700/50 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                    >
                        <option value="">{t('execution.allStatus', { ns: 'taskAdmin' })}</option>
                        <option value="running">{t('execution.statusRunning', { ns: 'taskAdmin' })}</option>
                        <option value="completed">{t('execution.statusCompleted', { ns: 'taskAdmin' })}</option>
                        <option value="failed">{t('execution.statusFailed', { ns: 'taskAdmin' })}</option>
                        <option value="timeout">{t('execution.statusTimeout', { ns: 'taskAdmin' })}</option>
                    </select>

                    {/* Agent 筛选 */}
                    <select
                        value={agentFilter}
                        onChange={e => setAgentFilter(e.target.value)}
                        className="text-xs bg-slate-800 text-slate-300 border border-slate-700/50 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                    >
                        <option value="">{t('execution.allAgents', { ns: 'taskAdmin' })}</option>
                        {agentCodes.map(code => (
                            <option key={code} value={code}>{code}</option>
                        ))}
                    </select>

                    {/* 时间范围 */}
                    <div className="flex items-center bg-slate-800 rounded-md border border-slate-700/50 overflow-hidden">
                        {(['today', 'week', 'month', 'all'] as TimeRange[]).map(range => (
                            <button
                                key={range}
                                onClick={() => setTimeRange(range)}
                                className={`text-xs px-3 py-1.5 transition-colors ${
                                    timeRange === range
                                        ? 'bg-blue-600/30 text-blue-300'
                                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                                }`}
                            >
                                {t(`execution.range_${range}`, { ns: 'taskAdmin' })}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* 时间线内容 */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
                {loading && records.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-400" />
                    </div>
                ) : records.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                        <svg className="w-16 h-16 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm">{t('execution.noRecords', { ns: 'taskAdmin' })}</p>
                        <p className="text-xs mt-1 text-slate-600">{t('execution.noRecordsHint', { ns: 'taskAdmin' })}</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {groups.map(group => (
                            <div key={group.dateKey}>
                                {/* 日期分隔线 */}
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="h-px flex-1 bg-slate-700/50" />
                                    <span className="text-xs text-slate-500 font-medium shrink-0">
                                        {getDateLabel(group.dateKey, k => t(k as any, { ns: 'taskAdmin' }))}
                                    </span>
                                    <div className="h-px flex-1 bg-slate-700/50" />
                                </div>

                                {/* 记录列表 */}
                                <div className="space-y-0.5">
                                    {group.records.map(record => (
                                        <RecordRow
                                            key={record.id}
                                            record={record}
                                            isExpanded={expandedId === record.id}
                                            onToggle={() => setExpandedId(prev => prev === record.id ? null : record.id)}
                                            t={k => t(k as any, { ns: 'taskAdmin' })}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* 分页 */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-center gap-2 pt-4 pb-2">
                                <button
                                    onClick={() => setPage(p => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                    className="text-xs px-3 py-1.5 rounded-md bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    {t('common:button.previousPage')}
                                </button>
                                <span className="text-xs text-slate-500">
                                    {t('common:label.pageInfo', { current: page + 1, total: totalPages })}
                                </span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                    disabled={page >= totalPages - 1}
                                    className="text-xs px-3 py-1.5 rounded-md bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    {t('common:button.nextPage')}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AgentExecutionTab;
