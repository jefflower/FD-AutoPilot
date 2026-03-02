/**
 * 任务仪表盘 — 展示 SyncBridge 状态、在线客户端概览及各任务类型的状态统计
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { taskApi, agentApi, clientApi } from '../../../shared/services/serverApi';
import type { ClientRegistration, AgentExecution, AgentStats } from '../../../shared/types/server';

/** 状态 → 颜色映射 */
const STATUS_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
    PENDING: { bg: 'bg-slate-500/10', text: 'text-slate-400', ring: 'ring-slate-500/20' },
    CLAIMED: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', ring: 'ring-yellow-500/20' },
    COMPLETED: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20' },
    FAILED: { bg: 'bg-red-500/10', text: 'text-red-400', ring: 'ring-red-500/20' },
    TIMEOUT: { bg: 'bg-orange-500/10', text: 'text-orange-400', ring: 'ring-orange-500/20' },
    CANCELLED: { bg: 'bg-gray-500/10', text: 'text-gray-400', ring: 'ring-gray-500/20' },
};

const STATUS_ORDER = ['PENDING', 'CLAIMED', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED'] as const;

/** 状态枚举 → i18n 键映射（类型安全） */
const STATUS_I18N_KEYS = {
    PENDING: 'dashboard.status.PENDING',
    CLAIMED: 'dashboard.status.CLAIMED',
    COMPLETED: 'dashboard.status.COMPLETED',
    FAILED: 'dashboard.status.FAILED',
    TIMEOUT: 'dashboard.status.TIMEOUT',
    CANCELLED: 'dashboard.status.CANCELLED',
} as const;

/** SyncBridge 状态数据 */
interface SyncBridgeStatus {
    activeWaiting: number;
    waitingTaskIds: number[];
}

/** 格式化耗时 */
function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
}

/** 格式化时间显示 */
function formatTime(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
        date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/** 单条执行记录时间线项 */
const ExecutionTimelineItem: React.FC<{ execution: AgentExecution }> = ({ execution }) => {
    const statusColor = execution.status === 'SUCCESS' ? 'bg-green-400'
        : execution.status === 'FAILED' ? 'bg-red-400'
        : execution.status === 'TIMEOUT' ? 'bg-orange-400'
        : execution.status === 'CANCELLED' ? 'bg-gray-400'
        : 'bg-blue-400 animate-pulse';

    const duration = execution.endTime && execution.startTime
        ? formatDuration(new Date(execution.endTime).getTime() - new Date(execution.startTime).getTime())
        : execution.durationMs
        ? formatDuration(execution.durationMs)
        : null;

    return (
        <div className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-700/20 transition-colors">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-200 truncate">{execution.agentCode}</span>
                    {execution.capability && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-700/50 text-slate-400 rounded">
                            {execution.capability}
                        </span>
                    )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                    {formatTime(execution.startTime || execution.createdAt)}
                </div>
                {execution.status === 'FAILED' && execution.errorMessage && (
                    <div className="text-xs text-red-400/80 mt-0.5 truncate">
                        {execution.errorMessage}
                    </div>
                )}
            </div>
            {duration && (
                <span className="text-xs text-slate-400 flex-shrink-0">{duration}</span>
            )}
        </div>
    );
};

/** 断路器状态颜色映射 */
const CIRCUIT_STATE_STYLES: Record<string, { bg: string; text: string; ring: string; dot: string }> = {
    CLOSED: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20', dot: 'bg-emerald-400' },
    HALF_OPEN: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', ring: 'ring-yellow-500/20', dot: 'bg-yellow-400' },
    OPEN: { bg: 'bg-red-500/10', text: 'text-red-400', ring: 'ring-red-500/20', dot: 'bg-red-400' },
};

/** 断路器状态面板 */
const CircuitBreakerPanel: React.FC = () => {
    const [status, setStatus] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(true);
    const { t } = useTranslation(['taskAdmin']);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const data = await agentApi.getCircuitBreakerStatus();
            setStatus(data || {});
        } catch { /* 静默 */ }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchStatus();
        timerRef.current = setInterval(fetchStatus, 15000);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [fetchStatus]);

    const handleReset = async (capability: string) => {
        try {
            await agentApi.resetCircuitBreaker(capability);
            fetchStatus();
        } catch { /* 静默 */ }
    };

    const entries = Object.entries(status);

    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg">
            <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
                {/* 断路器图标 */}
                <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
                </svg>
                <h3 className="text-sm font-medium text-slate-300">{t('dashboard.circuitBreaker')}</h3>
                <span className="ml-auto text-xs text-slate-500">
                    {entries.length > 0 ? `${entries.length} capabilities` : ''}
                </span>
            </div>
            <div className="p-4">
                {loading ? (
                    <div className="flex items-center justify-center h-16">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-600 border-t-amber-400" />
                    </div>
                ) : entries.length === 0 ? (
                    <div className="flex items-center justify-center h-16 text-slate-500 text-xs">
                        {t('dashboard.noCircuitBreakers')}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {entries.map(([capability, info]) => {
                            const state = (info?.state || 'CLOSED') as string;
                            const styles = CIRCUIT_STATE_STYLES[state] || CIRCUIT_STATE_STYLES.CLOSED;
                            const failureCount = info?.failureCount ?? 0;
                            const stateLabel = state === 'CLOSED'
                                ? t('dashboard.circuitClosed')
                                : state === 'HALF_OPEN'
                                ? t('dashboard.circuitHalfOpen')
                                : t('dashboard.circuitOpen');

                            return (
                                <div
                                    key={capability}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${styles.bg} ring-1 ${styles.ring}`}
                                >
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-slate-200 font-mono truncate">{capability}</span>
                                            <span className={`text-xs font-medium ${styles.text}`}>{stateLabel}</span>
                                        </div>
                                        {failureCount > 0 && (
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                {t('dashboard.failures')}: {failureCount}
                                            </div>
                                        )}
                                    </div>
                                    {state === 'OPEN' && (
                                        <button
                                            onClick={() => handleReset(capability)}
                                            className="px-2.5 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded border border-red-500/30 transition-colors flex-shrink-0"
                                        >
                                            {t('dashboard.resetBreaker')}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

/** 路由统计面板 */
const RouteStatsPanel: React.FC = () => {
    const [stats, setStats] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(true);
    const { t } = useTranslation(['taskAdmin']);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchStats = useCallback(async () => {
        try {
            const data = await agentApi.getRouteStatistics();
            setStats(data || {});
        } catch { /* 静默 */ }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchStats();
        timerRef.current = setInterval(fetchStats, 15000);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [fetchStats]);

    const entries = Object.entries(stats);

    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg">
            <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
                {/* 路由图标 */}
                <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
                <h3 className="text-sm font-medium text-slate-300">{t('dashboard.routeStats')}</h3>
                <span className="ml-auto text-xs text-slate-500">
                    {entries.length > 0 ? `${entries.length} capabilities` : ''}
                </span>
            </div>
            <div className="p-4">
                {loading ? (
                    <div className="flex items-center justify-center h-16">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-600 border-t-teal-400" />
                    </div>
                ) : entries.length === 0 ? (
                    <div className="flex items-center justify-center h-16 text-slate-500 text-xs">
                        {t('dashboard.noRouteStats')}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {entries.map(([capability, info]) => {
                            const availableInstances = info?.availableInstances ?? info?.instanceCount ?? 0;
                            const counter = info?.roundRobinCounter ?? info?.counter ?? 0;

                            return (
                                <div
                                    key={capability}
                                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-700/30"
                                >
                                    <span className="text-sm text-slate-200 font-mono truncate flex-1 min-w-0">{capability}</span>
                                    <div className="flex items-center gap-4 flex-shrink-0">
                                        <div className="text-right">
                                            <div className="text-xs text-slate-500">{t('dashboard.availableInstances')}</div>
                                            <div className={`text-sm font-bold ${availableInstances > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {availableInstances}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs text-slate-500">{t('dashboard.routeCounter')}</div>
                                            <div className="text-sm font-bold text-slate-300">{counter}</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

/** 单个 Agent 统计卡片行 */
const AgentStatCard: React.FC<{ stat: AgentStats }> = ({ stat }) => {
    const { t } = useTranslation(['taskAdmin']);
    const successRate = stat.successRate || 0;
    const avgDuration = stat.avgDurationMs || 0;

    return (
        <div className="px-4 py-3 flex items-center gap-4 hover:bg-slate-700/20 transition-colors">
            {/* Agent 信息 */}
            <div className="w-32 flex-shrink-0">
                <span className="text-sm text-slate-200 block truncate">{stat.agentName}</span>
                <code className="text-[10px] text-slate-500">{stat.agentCode}</code>
            </div>

            {/* 成功率进度条 */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${
                                successRate >= 90 ? 'bg-green-500' :
                                successRate >= 70 ? 'bg-yellow-500' :
                                'bg-red-500'
                            }`}
                            style={{ width: `${Math.min(100, successRate)}%` }}
                        />
                    </div>
                    <span className="text-xs text-slate-400 w-12 text-right">{successRate.toFixed(1)}%</span>
                </div>
            </div>

            {/* 统计数字 */}
            <div className="flex items-center gap-3 text-xs flex-shrink-0">
                <span className="text-slate-400">{stat.totalExecutions} {t('dashboard.times')}</span>
                <span className="text-green-400">{stat.successCount} {t('dashboard.success')}</span>
                <span className="text-red-400">{stat.failedCount} {t('dashboard.failed')}</span>
                <span className="text-slate-400">{formatDuration(avgDuration)}</span>
            </div>
        </div>
    );
};

/** Agent 执行统计面板 */
const ExecutionStatsPanel: React.FC = () => {
    const [stats, setStats] = useState<AgentStats[]>([]);
    const [loading, setLoading] = useState(true);
    const { t } = useTranslation(['taskAdmin']);

    useEffect(() => {
        agentApi.getStats()
            .then(setStats)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg">
            <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
                {/* 统计图标 */}
                <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
                <h3 className="text-sm font-medium text-slate-300">{t('dashboard.executionStats')}</h3>
                <span className="ml-auto text-xs text-slate-500">
                    {stats.length > 0 ? `${stats.length} agents` : ''}
                </span>
            </div>
            <div className="divide-y divide-slate-700/30 max-h-80 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-24">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-600 border-t-indigo-400" />
                    </div>
                ) : stats.length === 0 ? (
                    <div className="flex items-center justify-center h-24 text-slate-500 text-xs">
                        {t('dashboard.noStats')}
                    </div>
                ) : (
                    stats.map(stat => (
                        <AgentStatCard key={stat.agentCode} stat={stat} />
                    ))
                )}
            </div>
        </div>
    );
};

/** 最近执行记录面板 */
const RecentExecutionsPanel: React.FC = () => {
    const { t } = useTranslation(['taskAdmin', 'common']);
    const [executions, setExecutions] = useState<AgentExecution[]>([]);
    const [loading, setLoading] = useState(true);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const result = await agentApi.getRecentExecutions(20);
                setExecutions(result);
            } catch {
                // 静默处理错误，不影响仪表盘其他部分
            } finally {
                setLoading(false);
            }
        };
        fetchData();
        timerRef.current = setInterval(fetchData, 10_000);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg">
            <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
                {/* 时间线图标 */}
                <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                </svg>
                <h3 className="text-sm font-medium text-slate-300">{t('dashboard.recentExecutions')}</h3>
                <span className="ml-auto text-xs text-slate-500">
                    {executions.length > 0 ? `${executions.length} ${t('dashboard.records')}` : ''}
                </span>
            </div>
            <div className="divide-y divide-slate-700/30 max-h-96 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-24">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-600 border-t-violet-400" />
                    </div>
                ) : executions.length === 0 ? (
                    <div className="flex items-center justify-center h-24 text-slate-500 text-xs">
                        {t('dashboard.noExecutions')}
                    </div>
                ) : (
                    executions.map(exec => (
                        <ExecutionTimelineItem key={exec.id} execution={exec} />
                    ))
                )}
            </div>
        </div>
    );
};

const TaskDashboardTab: React.FC = () => {
    const { t } = useTranslation(['taskAdmin', 'common']);

    const [data, setData] = useState<Record<string, Record<string, number>>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // SyncBridge 状态
    const [bridgeStatus, setBridgeStatus] = useState<SyncBridgeStatus>({ activeWaiting: 0, waitingTaskIds: [] });
    // 在线客户端
    const [onlineClients, setOnlineClients] = useState<ClientRegistration[]>([]);
    // 导出状态
    const [exporting, setExporting] = useState(false);

    const handleServerExport = useCallback(async (format: 'csv' | 'json') => {
        setExporting(true);
        try {
            const blob = format === 'csv'
                ? await agentApi.exportExecutionsCsv({ days: 30 })
                : await agentApi.exportExecutionsJson({ days: 30 });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `agent-executions-${new Date().toISOString().slice(0, 10)}.${format}`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[Dashboard] Export failed:', e);
        } finally {
            setExporting(false);
        }
    }, []);

    const loadDashboard = useCallback(async () => {
        try {
            const [result, bridge, clients] = await Promise.all([
                taskApi.getDashboard(),
                agentApi.getSyncBridgeStatus().catch(() => ({ activeWaiting: 0, waitingTaskIds: [] })),
                clientApi.getOnlineClients().catch(() => [] as ClientRegistration[]),
            ]);
            setData(result);
            setBridgeStatus(bridge);
            setOnlineClients(clients);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('dashboard.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        loadDashboard();
        timerRef.current = setInterval(loadDashboard, 10_000);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [loadDashboard]);

    const taskTypes = Object.keys(data);

    /** 解析 capabilities 字符串为数组 */
    const parseCapabilities = (caps: string): string[] => {
        if (!caps) return [];
        try {
            const parsed = JSON.parse(caps);
            if (Array.isArray(parsed)) return parsed;
        } catch {
            // 如果不是 JSON，尝试逗号分隔
        }
        return caps.split(',').map(s => s.trim()).filter(Boolean);
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-semibold text-white">{t('dashboard.title')}</h1>
                        <p className="text-xs text-slate-400 mt-1">{t('dashboard.autoRefresh')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => handleServerExport('csv')}
                            disabled={exporting}
                            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-white/10 transition-colors disabled:opacity-50"
                            title={t('dashboard.exportCsvServer')}
                        >
                            {exporting ? t('dashboard.exporting') : 'CSV'}
                        </button>
                        <button
                            onClick={() => handleServerExport('json')}
                            disabled={exporting}
                            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-white/10 transition-colors disabled:opacity-50"
                            title={t('dashboard.exportJsonServer')}
                        >
                            {exporting ? t('dashboard.exporting') : 'JSON'}
                        </button>
                        <button
                            onClick={loadDashboard}
                            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-white/10 transition-colors"
                        >
                            {t('common:button.refresh')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {loading && taskTypes.length === 0 ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-400" />
                    </div>
                ) : error && taskTypes.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-red-400 text-sm">{error}</div>
                ) : (
                    <>
                        {/* === SyncBridge + 在线客户端 顶部概览 === */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                            {/* SyncBridge 状态卡片 */}
                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-5">
                                <div className="flex items-center gap-2 mb-3">
                                    {/* 桥接图标 */}
                                    <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                                    </svg>
                                    <h3 className="text-sm font-medium text-white">SyncBridge</h3>
                                </div>

                                <div className="flex items-center gap-4">
                                    {/* 状态指示 */}
                                    <div className="flex items-center gap-2">
                                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${bridgeStatus.activeWaiting === 0 ? 'bg-emerald-400' : 'bg-yellow-400'} animate-pulse`} />
                                        <span className={`text-sm font-medium ${bridgeStatus.activeWaiting === 0 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                                            {bridgeStatus.activeWaiting === 0 ? t('dashboard.bridgeIdle') : `${t('dashboard.bridgeProcessing')} (${bridgeStatus.activeWaiting})`}
                                        </span>
                                    </div>

                                    {/* 活跃等待数 */}
                                    <div className="flex items-center gap-1.5 ml-auto">
                                        <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span className="text-2xl font-bold text-white">{bridgeStatus.activeWaiting}</span>
                                        <span className="text-xs text-slate-400">{t('dashboard.waiting')}</span>
                                    </div>
                                </div>

                                {/* 等待任务 ID 列表 */}
                                {bridgeStatus.waitingTaskIds.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-slate-700/50">
                                        <p className="text-xs text-slate-400 mb-1.5">{t('dashboard.waitingTaskIds')}:</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {bridgeStatus.waitingTaskIds.map((id) => (
                                                <span
                                                    key={id}
                                                    className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/20"
                                                >
                                                    #{id}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 在线客户端卡片 */}
                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-5">
                                <div className="flex items-center gap-2 mb-3">
                                    {/* 客户端图标 */}
                                    <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                                    </svg>
                                    <h3 className="text-sm font-medium text-white">{t('dashboard.onlineClients')}</h3>
                                    <span className="ml-auto text-2xl font-bold text-white">{onlineClients.length}</span>
                                </div>

                                {onlineClients.length === 0 ? (
                                    <p className="text-xs text-slate-500">{t('dashboard.noOnlineClients')}</p>
                                ) : (
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {onlineClients.map((client) => {
                                            const caps = parseCapabilities(client.enabledCapabilities);
                                            return (
                                                <div
                                                    key={client.clientId}
                                                    className="bg-slate-700/30 rounded-md px-3 py-2"
                                                >
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                        <span className="text-xs font-mono text-slate-200 truncate" title={client.clientId}>
                                                            {client.clientId}
                                                        </span>
                                                        <span className="text-[10px] text-slate-500 ml-auto">{client.clientType}</span>
                                                    </div>
                                                    {caps.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {caps.map((cap) => (
                                                                <span
                                                                    key={cap}
                                                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20"
                                                                >
                                                                    {cap}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* === 最近执行记录 === */}
                        <div className="mb-6">
                            <RecentExecutionsPanel />
                        </div>

                        {/* === 断路器状态 + 路由统计 === */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                            <CircuitBreakerPanel />
                            <RouteStatsPanel />
                        </div>

                        {/* === Agent 执行统计 === */}
                        <div className="mb-6">
                            <ExecutionStatsPanel />
                        </div>

                        {/* === 任务类型统计卡片 === */}
                        {taskTypes.length === 0 ? (
                            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">{t('dashboard.noData')}</div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {taskTypes.map((taskType) => {
                                    const statusMap = data[taskType];
                                    const total = Object.values(statusMap).reduce((a, b) => a + b, 0);
                                    return (
                                        <div
                                            key={taskType}
                                            className="bg-white/5 rounded-xl border border-white/10 p-5 hover:bg-white/[0.07] transition-colors"
                                        >
                                            {/* Card Header */}
                                            <div className="flex items-center justify-between mb-4">
                                                <h3 className="text-sm font-medium text-white truncate">{taskType}</h3>
                                                <span className="text-xs text-slate-400">
                                                    {t('dashboard.totalTasks')}: {total}
                                                </span>
                                            </div>

                                            {/* Status Grid */}
                                            <div className="grid grid-cols-3 gap-2">
                                                {STATUS_ORDER.map((status) => {
                                                    const count = statusMap[status] || 0;
                                                    const colors = STATUS_COLORS[status] || STATUS_COLORS.PENDING;
                                                    return (
                                                        <div
                                                            key={status}
                                                            className={`${colors.bg} rounded-lg p-2.5 ring-1 ${colors.ring}`}
                                                        >
                                                            <div className={`text-lg font-bold ${colors.text}`}>{count}</div>
                                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                                                {t(STATUS_I18N_KEYS[status])}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default TaskDashboardTab;
