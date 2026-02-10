/**
 * 同步管理组件 (管理员专属)
 * 功能：
 * - 手动触发同步
 * - 配置 cron 表达式
 * - 查看同步状态
 * - 查看同步日志
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, configApi } from '../../services/serverApi';
import type { SyncResult, SyncConfig, SyncLog } from '../../types/server';
// 常用 cron 预设 - 工厂函数
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getCronPresets = (t: (...args: any[]) => string) => [
    { label: t('sync.cronPresets.every5min'), value: '0 0/5 * * * ?' },
    { label: t('sync.cronPresets.every10min'), value: '0 0/10 * * * ?' },
    { label: t('sync.cronPresets.every30min'), value: '0 0/30 * * * ?' },
    { label: t('sync.cronPresets.everyHour'), value: '0 0 * * * ?' },
    { label: t('sync.cronPresets.dailyAt9'), value: '0 0 9 * * ?' },
];

const ManualSyncTab: React.FC = () => {
    const { t, i18n } = useTranslation(['admin', 'common']);

    const cronPresets = useMemo(() => getCronPresets(t), [t]);

    const [syncing, setSyncing] = useState(false);
    const [result, setResult] = useState<SyncResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    // 配置状态
    const [config, setConfig] = useState<SyncConfig | null>(null);
    const [cronExpression, setCronExpression] = useState('');
    const [syncEnabled, setSyncEnabled] = useState(true);
    const [lastSyncTime, setLastSyncTime] = useState('');

    // 自动推送状态
    const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
    const [autoReplyLoading, setAutoReplyLoading] = useState(false);

    // 日志状态
    const [logs, setLogs] = useState<SyncLog[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);

    // 加载配置
    const loadConfig = useCallback(async () => {
        try {
            const cfg = await adminApi.getSyncConfig();
            setConfig(cfg);
            setCronExpression(cfg.cronExpression || '');
            setSyncEnabled(cfg.syncEnabled);
            setLastSyncTime(cfg.lastSyncTime || '');
        } catch (err) {
            console.error('Failed to load sync config:', err);
        }
    }, []);

    // 加载日志
    const loadLogs = useCallback(async () => {
        setLoadingLogs(true);
        try {
            const response = await adminApi.getSyncLogs(0, 10);
            setLogs(response.content);
        } catch (err) {
            console.error('Failed to load sync logs:', err);
        } finally {
            setLoadingLogs(false);
        }
    }, []);

    // 加载自动推送配置
    const loadAutoReplyConfig = useCallback(async () => {
        try {
            const cfg = await configApi.getAutoReply();
            setAutoReplyEnabled(cfg.enabled);
        } catch {
            // 静默忽略
        }
    }, []);

    const handleToggleAutoReply = async () => {
        setAutoReplyLoading(true);
        try {
            const newVal = !autoReplyEnabled;
            await configApi.setAutoReply(newVal);
            setAutoReplyEnabled(newVal);
        } catch (err) {
            alert(t('sync.config.setFailed', { error: (err as Error).message }));
        } finally {
            setAutoReplyLoading(false);
        }
    };

    // 初始化加载
    useEffect(() => {
        loadConfig();
        loadLogs();
        loadAutoReplyConfig();
    }, [loadConfig, loadLogs, loadAutoReplyConfig]);

    // 触发同步
    const handleSync = async () => {
        setSyncing(true);
        setError(null);
        setResult(null);

        try {
            const syncResult = await adminApi.triggerSync();
            setResult(syncResult);
            loadLogs(); // 刷新日志
            loadConfig(); // 刷新配置（更新上次同步时间）
        } catch (err) {
            setError(err instanceof Error ? err.message : t('sync.syncFailed'));
        } finally {
            setSyncing(false);
        }
    };

    // 保存配置
    const handleSaveConfig = async () => {
        try {
            await adminApi.updateSyncConfig({
                cronExpression,
                syncEnabled: syncEnabled ? 'true' : 'false',
                lastSyncTime: lastSyncTime || undefined,
            });
            await loadConfig();
            alert(t('sync.config.saveSuccess'));
        } catch (err) {
            alert(t('sync.config.saveFailed', { error: err instanceof Error ? err.message : t('common:error.unknownError') }));
        }
    };

    // 格式化时间
    const formatTime = (time: string | null) => {
        if (!time) return '-';
        try {
            return new Date(time).toLocaleString(i18n.language);
        } catch {
            return time;
        }
    };

    // 状态标签
    const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
        const colors: Record<string, string> = {
            SUCCESS: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
            FAILED: 'bg-red-500/20 text-red-400 border-red-500/30',
            RUNNING: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
        };
        return (
            <span className={`px-2 py-0.5 rounded text-xs border ${colors[status] || 'bg-slate-500/20 text-slate-400'}`}>
                {t(`sync.logs.status.${status}` as any)}
            </span>
        );
    };

    return (
        <div className="flex-1 flex flex-col h-full overflow-auto p-6">
            <div className="max-w-4xl mx-auto w-full space-y-6">
                {/* 标题 */}
                <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-2">{t('sync.title')}</h1>
                    <p className="text-slate-400">{t('sync.subtitle')}</p>
                </div>

                {/* 同步状态卡片 */}
                <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-white">{t('sync.status.title')}</h2>
                        <div className="flex items-center gap-2">
                            {config?.isSyncing ? (
                                <span className="flex items-center gap-2 text-yellow-400">
                                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    {t('sync.status.syncing')}
                                </span>
                            ) : (
                                <span className="text-emerald-400">{t('sync.status.idle')}</span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                        <div>
                            <span className="text-slate-400">{t('sync.status.lastSync')}</span>
                            <span className="text-white ml-2">{formatTime(config?.lastSyncTime || null)}</span>
                        </div>
                        <div>
                            <span className="text-slate-400">{t('sync.status.autoSync')}</span>
                            <span className={`ml-2 ${syncEnabled ? 'text-emerald-400' : 'text-red-400'}`}>
                                {syncEnabled ? t('sync.status.enabled') : t('sync.status.disabled')}
                            </span>
                        </div>
                    </div>

                    <button
                        onClick={handleSync}
                        disabled={syncing || config?.isSyncing}
                        className="w-full px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium rounded-xl shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                        {syncing ? t('sync.status.syncing_btn') : t('sync.status.syncNow')}
                    </button>

                    {/* 结果显示 */}
                    {result && (
                        <div className={`mt-4 p-4 rounded-lg ${result.success ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                            <p className={result.success ? 'text-emerald-400' : 'text-red-400'}>{result.message}</p>
                            {result.success && (
                                <p className="text-slate-300 text-sm mt-1">
                                    {t('sync.status.newCount', { count: result.syncedCount })}{t('sync.status.updateCount', { count: result.updatedCount || 0 })}
                                </p>
                            )}
                        </div>
                    )}

                    {error && (
                        <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                            <p className="text-red-400">{error}</p>
                        </div>
                    )}
                </div>

                {/* 配置卡片 */}
                <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                    <h2 className="text-lg font-semibold text-white mb-4">{t('sync.config.title')}</h2>

                    <div className="space-y-4">
                        {/* 自动同步开关 */}
                        <div className="flex items-center justify-between">
                            <span className="text-slate-300">{t('sync.config.enableAutoSync')}</span>
                            <button
                                onClick={() => setSyncEnabled(!syncEnabled)}
                                className={`relative w-12 h-6 rounded-full transition-colors ${syncEnabled ? 'bg-indigo-500' : 'bg-slate-600'}`}
                            >
                                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${syncEnabled ? 'left-7' : 'left-1'}`} />
                            </button>
                        </div>

                        {/* 自动推送回复开关 */}
                        <div className="flex items-center justify-between p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                            <div>
                                <span className="text-slate-300">{t('sync.config.autoReply')}</span>
                                <p className="text-[10px] text-slate-500 mt-0.5">{t('sync.config.autoReplyDesc')}</p>
                            </div>
                            <button
                                onClick={handleToggleAutoReply}
                                disabled={autoReplyLoading}
                                className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${autoReplyEnabled ? 'bg-emerald-500' : 'bg-slate-600'} ${autoReplyLoading ? 'opacity-50' : ''}`}
                            >
                                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${autoReplyEnabled ? 'left-7' : 'left-1'}`} />
                            </button>
                        </div>

                        {/* Cron 表达式 */}
                        <div>
                            <label className="block text-slate-300 mb-2">{t('sync.config.cronExpression')}</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={cronExpression}
                                    onChange={(e) => setCronExpression(e.target.value)}
                                    className="flex-1 px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                                    placeholder="0 0/5 * * * ?"
                                />
                                <select
                                    onChange={(e) => setCronExpression(e.target.value)}
                                    className="px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                                >
                                    <option value="">{t('sync.config.cronPreset')}</option>
                                    {cronPresets.map((preset) => (
                                        <option key={preset.value} value={preset.value}>{preset.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* 上次同步时间（可编辑） */}
                        <div>
                            <label className="block text-slate-300 mb-2">{t('sync.config.lastSyncTimeLabel')}</label>
                            <input
                                type="datetime-local"
                                value={lastSyncTime ? lastSyncTime.slice(0, 16) : ''}
                                onChange={(e) => setLastSyncTime(e.target.value ? e.target.value + ':00' : '')}
                                className="w-full px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                            />
                        </div>

                        <button
                            onClick={handleSaveConfig}
                            className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                        >
                            {t('sync.config.saveConfig')}
                        </button>
                    </div>
                </div>

                {/* 同步日志 */}
                <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-white">{t('sync.logs.title')}</h2>
                        <button onClick={loadLogs} disabled={loadingLogs} className="text-indigo-400 hover:text-indigo-300 text-sm">
                            {loadingLogs ? t('sync.logs.refreshing') : t('common:button.refresh')}
                        </button>
                    </div>

                    {logs.length === 0 ? (
                        <p className="text-slate-400 text-center py-4">{t('sync.logs.noRecords')}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-slate-400 border-b border-white/10">
                                        <th className="text-left py-2 px-2">{t('sync.logs.table.time')}</th>
                                        <th className="text-left py-2 px-2">{t('sync.logs.table.type')}</th>
                                        <th className="text-left py-2 px-2">{t('sync.logs.table.status')}</th>
                                        <th className="text-right py-2 px-2">{t('sync.logs.table.added')}</th>
                                        <th className="text-right py-2 px-2">{t('sync.logs.table.updated')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log) => (
                                        <tr key={log.id} className="border-b border-white/5 text-slate-300">
                                            <td className="py-2 px-2">{formatTime(log.startTime)}</td>
                                            <td className="py-2 px-2">
                                                {t(`sync.logs.triggerType.${log.triggerType}` as any)}
                                            </td>
                                            <td className="py-2 px-2">
                                                <StatusBadge status={log.status} />
                                            </td>
                                            <td className="text-right py-2 px-2 text-emerald-400">{log.ticketsSynced}</td>
                                            <td className="text-right py-2 px-2 text-blue-400">{log.ticketsUpdated}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ManualSyncTab;
