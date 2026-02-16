/**
 * 任务仪表盘 — 展示各任务类型的状态统计
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { taskApi } from '../../../shared/services/serverApi';

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

const TaskDashboardTab: React.FC = () => {
    const { t } = useTranslation(['taskAdmin', 'common']);

    const [data, setData] = useState<Record<string, Record<string, number>>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const loadDashboard = useCallback(async () => {
        try {
            const result = await taskApi.getDashboard();
            setData(result);
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

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-semibold text-white">{t('dashboard.title')}</h1>
                        <p className="text-xs text-slate-400 mt-1">{t('dashboard.autoRefresh')}</p>
                    </div>
                    <button
                        onClick={loadDashboard}
                        className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-white/10 transition-colors"
                    >
                        {t('common:button.refresh')}
                    </button>
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
                ) : taskTypes.length === 0 ? (
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
            </div>
        </div>
    );
};

export default TaskDashboardTab;
