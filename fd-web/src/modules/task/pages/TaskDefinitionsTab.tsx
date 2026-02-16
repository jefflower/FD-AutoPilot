/**
 * 任务定义管理 — 列表展示、启用/禁用、手动触发
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { taskApi } from '../../../shared/services/serverApi';
import type { TaskDefinition } from '../../../shared/types/server';

/** 执行模式 → i18n 键映射（类型安全） */
const EXEC_MODE_I18N_KEYS = {
    CLIENT_DISTRIBUTED: 'definitions.executionMode.CLIENT_DISTRIBUTED',
    SERVER_SCHEDULED: 'definitions.executionMode.SERVER_SCHEDULED',
    SERVER_TRIGGERED: 'definitions.executionMode.SERVER_TRIGGERED',
} as const;

const TaskDefinitionsTab: React.FC = () => {
    const { t } = useTranslation(['taskAdmin', 'common']);

    const [definitions, setDefinitions] = useState<TaskDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [operatingId, setOperatingId] = useState<number | null>(null);

    const showSuccess = (msg: string) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(null), 3000);
    };

    const loadDefinitions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await taskApi.getDefinitions();
            setDefinitions(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('definitions.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        loadDefinitions();
    }, [loadDefinitions]);

    const handleToggle = async (def: TaskDefinition) => {
        setOperatingId(def.id);
        setError(null);
        try {
            await taskApi.toggleDefinition(def.id);
            showSuccess(t('definitions.toggleSuccess'));
            loadDefinitions();
        } catch (err) {
            setError(t('definitions.toggleFailed', { error: err instanceof Error ? err.message : '' }));
        } finally {
            setOperatingId(null);
        }
    };

    const handleTrigger = async (def: TaskDefinition) => {
        setOperatingId(def.id);
        setError(null);
        try {
            await taskApi.triggerTask(def.code);
            showSuccess(t('definitions.triggerSuccess'));
        } catch (err) {
            setError(t('definitions.triggerFailed', { error: err instanceof Error ? err.message : '' }));
        } finally {
            setOperatingId(null);
        }
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-semibold text-white">{t('definitions.title')}</h1>
                    <button
                        onClick={loadDefinitions}
                        className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-white/10 transition-colors"
                    >
                        {t('common:button.refresh')}
                    </button>
                </div>
            </div>

            {/* Messages */}
            {error && (
                <div className="mx-6 mt-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                    {error}
                </div>
            )}
            {successMsg && (
                <div className="mx-6 mt-3 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-xs">
                    {successMsg}
                </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto p-6">
                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-400" />
                    </div>
                ) : definitions.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-slate-400 text-sm">{t('definitions.noData')}</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead>
                                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                                    <th className="px-4 py-3 font-medium">{t('definitions.table.code')}</th>
                                    <th className="px-4 py-3 font-medium">{t('definitions.table.name')}</th>
                                    <th className="px-4 py-3 font-medium">{t('definitions.table.executionMode')}</th>
                                    <th className="px-4 py-3 font-medium">{t('definitions.table.cronExpression')}</th>
                                    <th className="px-4 py-3 font-medium text-center">{t('definitions.table.timeout')}</th>
                                    <th className="px-4 py-3 font-medium text-center">{t('definitions.table.maxRetries')}</th>
                                    <th className="px-4 py-3 font-medium text-center">{t('definitions.table.maxConcurrency')}</th>
                                    <th className="px-4 py-3 font-medium text-center">{t('definitions.table.enabled')}</th>
                                    <th className="px-4 py-3 font-medium text-center">{t('definitions.table.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {definitions.map((def) => (
                                    <tr
                                        key={def.id}
                                        className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                                    >
                                        <td className="px-4 py-3 text-white font-mono text-xs">{def.code}</td>
                                        <td className="px-4 py-3 text-slate-200">{def.name}</td>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-0.5 text-xs rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                                {t(EXEC_MODE_I18N_KEYS[def.executionMode])}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                                            {def.cronExpression || '-'}
                                        </td>
                                        <td className="px-4 py-3 text-slate-300 text-center">{def.timeoutSeconds}</td>
                                        <td className="px-4 py-3 text-slate-300 text-center">{def.maxRetries}</td>
                                        <td className="px-4 py-3 text-slate-300 text-center">{def.maxConcurrency}</td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                onClick={() => handleToggle(def)}
                                                disabled={operatingId === def.id}
                                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                                                    def.enabled ? 'bg-emerald-500' : 'bg-slate-600'
                                                }`}
                                            >
                                                <span
                                                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                                        def.enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                                                    }`}
                                                />
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                onClick={() => handleTrigger(def)}
                                                disabled={operatingId === def.id || !def.enabled}
                                                className="px-2.5 py-1 text-xs bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded border border-indigo-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                {t('definitions.action.trigger')}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TaskDefinitionsTab;
