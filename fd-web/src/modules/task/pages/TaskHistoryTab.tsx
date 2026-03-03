/**
 * 任务执行历史 — 分页表格 + 按类型筛选
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { taskApi } from '../../../shared/services/serverApi';
import type { TaskInstance, TaskDefinition } from '../../../shared/types/server';

/** 状态 → badge 颜色 */
const STATUS_BADGE: Record<string, string> = {
    PENDING: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    CLAIMED: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    COMPLETED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    FAILED: 'bg-red-500/20 text-red-300 border-red-500/30',
    TIMEOUT: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    CANCELLED: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
};

/** 状态 → i18n 键映射（类型安全） */
const STATUS_I18N_KEYS = {
    PENDING: 'history.status.PENDING',
    CLAIMED: 'history.status.CLAIMED',
    COMPLETED: 'history.status.COMPLETED',
    FAILED: 'history.status.FAILED',
    TIMEOUT: 'history.status.TIMEOUT',
    CANCELLED: 'history.status.CANCELLED',
} as const;

/** 触发方式 → i18n 键映射（类型安全） */
const TRIGGER_I18N_KEYS = {
    EVENT: 'history.triggerType.EVENT',
    SCHEDULED: 'history.triggerType.SCHEDULED',
    MANUAL: 'history.triggerType.MANUAL',
} as const;

const PAGE_SIZE = 20;

const TaskHistoryTab: React.FC = () => {
    const { t } = useTranslation(['taskAdmin', 'common']);

    const [records, setRecords] = useState<TaskInstance[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [totalElements, setTotalElements] = useState(0);

    // 任务类型筛选
    const [typeFilter, setTypeFilter] = useState('');
    const [taskTypes, setTaskTypes] = useState<string[]>([]);

    // 加载可用的任务类型列表
    useEffect(() => {
        taskApi.getDefinitions().then((defs: TaskDefinition[]) => {
            setTaskTypes(defs.map((d) => d.code));
        }).catch(() => {});
    }, []);

    const loadHistory = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await taskApi.getHistory({
                type: typeFilter || undefined,
                page,
                size: PAGE_SIZE,
            });
            setRecords(result.content);
            setTotalPages(result.totalPages);
            setTotalElements(result.totalElements);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('history.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [page, typeFilter, t]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const handleTypeChange = (newType: string) => {
        setTypeFilter(newType);
        setPage(0);
    };

    const formatDateTime = (dateStr?: string | null) => {
        if (!dateStr) return '-';
        try {
            return new Date(dateStr).toLocaleString();
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-semibold text-white">{t('history.title')}</h1>
                    <div className="flex items-center gap-3">
                        {/* Type Filter */}
                        <select
                            value={typeFilter}
                            onChange={(e) => handleTypeChange(e.target.value)}
                            className="px-3 py-1.5 text-xs bg-white/5 text-slate-300 rounded-lg border border-white/10 focus:outline-none focus:border-indigo-500/50"
                        >
                            <option value="">{t('history.allTypes')}</option>
                            {taskTypes.map((type) => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>

                        <button
                            onClick={loadHistory}
                            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-white/10 transition-colors"
                        >
                            {t('common:button.refresh')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="mx-6 mt-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                    {error}
                </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto p-6">
                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-400" />
                    </div>
                ) : records.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-slate-400 text-sm">{t('history.noData')}</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead>
                                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                                    <th className="px-4 py-3 font-medium">{t('history.table.id')}</th>
                                    <th className="px-4 py-3 font-medium">{t('history.table.taskType')}</th>
                                    <th className="px-4 py-3 font-medium">{t('history.table.referenceId')}</th>
                                    <th className="px-4 py-3 font-medium">{t('history.table.status')}</th>
                                    <th className="px-4 py-3 font-medium">{t('history.table.assignedTo')}</th>
                                    <th className="px-4 py-3 font-medium">{t('history.table.triggerType')}</th>
                                    <th className="px-4 py-3 font-medium">{t('history.table.createdAt')}</th>
                                    <th className="px-4 py-3 font-medium">{t('history.table.completedAt')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {records.map((record) => (
                                    <tr
                                        key={record.id}
                                        className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                                    >
                                        <td className="px-4 py-3 text-slate-300 font-mono text-xs">{record.id}</td>
                                        <td className="px-4 py-3 text-white text-xs">{record.taskType}</td>
                                        <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                                            {record.referenceId || '-'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-0.5 text-xs rounded border ${STATUS_BADGE[record.status] || STATUS_BADGE.PENDING}`}>
                                                {t(STATUS_I18N_KEYS[record.status])}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-400 text-xs">{record.assignedTo || '-'}</td>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-0.5 text-xs rounded bg-white/5 text-slate-300 border border-white/10">
                                                {t(TRIGGER_I18N_KEYS[record.triggerType])}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-400 text-xs">{formatDateTime(record.createdAt)}</td>
                                        <td className="px-4 py-3 text-slate-400 text-xs">{formatDateTime(record.completedAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 0 && (
                <div className="flex-shrink-0 px-6 py-3 border-t border-white/10 flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                        {t('common:label.total', { count: totalElements })}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={page === 0}
                            className="px-3 py-1 text-xs bg-white/5 hover:bg-white/10 text-slate-300 rounded border border-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {t('common:button.previousPage')}
                        </button>
                        <span className="text-xs text-slate-400">
                            {t('common:label.pageInfo', { current: page + 1, total: totalPages })}
                        </span>
                        <button
                            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                            disabled={page >= totalPages - 1}
                            className="px-3 py-1 text-xs bg-white/5 hover:bg-white/10 text-slate-300 rounded border border-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {t('common:button.nextPage')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TaskHistoryTab;
