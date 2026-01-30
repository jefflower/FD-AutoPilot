/**
 * 同步管理组件 (管理员专属)
 * 功能：
 * - 手动触发同步
 * - 配置 cron 表达式
 * - 查看同步状态
 * - 查看同步日志
 */

import React, { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../../services/serverApi';
import type { SyncResult, SyncConfig, SyncLog } from '../../types/server';

// 常用 cron 预设
const CRON_PRESETS = [
    { label: '每5分钟', value: '0 0/5 * * * ?' },
    { label: '每10分钟', value: '0 0/10 * * * ?' },
    { label: '每30分钟', value: '0 0/30 * * * ?' },
    { label: '每小时', value: '0 0 * * * ?' },
    { label: '每天 9:00', value: '0 0 9 * * ?' },
];

const ManualSyncTab: React.FC = () => {
    const [syncing, setSyncing] = useState(false);
    const [result, setResult] = useState<SyncResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    // 配置状态
    const [config, setConfig] = useState<SyncConfig | null>(null);
    const [cronExpression, setCronExpression] = useState('');
    const [syncEnabled, setSyncEnabled] = useState(true);
    const [lastSyncTime, setLastSyncTime] = useState('');

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

    // 初始化加载
    useEffect(() => {
        loadConfig();
        loadLogs();
    }, [loadConfig, loadLogs]);

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
            setError(err instanceof Error ? err.message : '同步失败');
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
            alert('配置保存成功！重启服务生效 cron 配置');
        } catch (err) {
            alert('保存失败：' + (err instanceof Error ? err.message : '未知错误'));
        }
    };

    // 格式化时间
    const formatTime = (time: string | null) => {
        if (!time) return '-';
        try {
            return new Date(time).toLocaleString('zh-CN');
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
                {status === 'SUCCESS' ? '成功' : status === 'FAILED' ? '失败' : '进行中'}
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
                    <h1 className="text-2xl font-bold text-white mb-2">同步管理</h1>
                    <p className="text-slate-400">配置自动同步或手动触发 Freshdesk 工单同步</p>
                </div>

                {/* 同步状态卡片 */}
                <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-white">同步状态</h2>
                        <div className="flex items-center gap-2">
                            {config?.isSyncing ? (
                                <span className="flex items-center gap-2 text-yellow-400">
                                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    正在同步中...
                                </span>
                            ) : (
                                <span className="text-emerald-400">空闲</span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                        <div>
                            <span className="text-slate-400">上次同步：</span>
                            <span className="text-white ml-2">{formatTime(config?.lastSyncTime || null)}</span>
                        </div>
                        <div>
                            <span className="text-slate-400">自动同步：</span>
                            <span className={`ml-2 ${syncEnabled ? 'text-emerald-400' : 'text-red-400'}`}>
                                {syncEnabled ? '已启用' : '已禁用'}
                            </span>
                        </div>
                    </div>

                    <button
                        onClick={handleSync}
                        disabled={syncing || config?.isSyncing}
                        className="w-full px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium rounded-xl shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                        {syncing ? '正在同步...' : '立即同步'}
                    </button>

                    {/* 结果显示 */}
                    {result && (
                        <div className={`mt-4 p-4 rounded-lg ${result.success ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                            <p className={result.success ? 'text-emerald-400' : 'text-red-400'}>{result.message}</p>
                            {result.success && (
                                <p className="text-slate-300 text-sm mt-1">
                                    新增：{result.syncedCount}，更新：{result.updatedCount || 0}
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
                    <h2 className="text-lg font-semibold text-white mb-4">同步配置</h2>

                    <div className="space-y-4">
                        {/* 自动同步开关 */}
                        <div className="flex items-center justify-between">
                            <span className="text-slate-300">启用自动同步</span>
                            <button
                                onClick={() => setSyncEnabled(!syncEnabled)}
                                className={`relative w-12 h-6 rounded-full transition-colors ${syncEnabled ? 'bg-indigo-500' : 'bg-slate-600'}`}
                            >
                                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${syncEnabled ? 'left-7' : 'left-1'}`} />
                            </button>
                        </div>

                        {/* Cron 表达式 */}
                        <div>
                            <label className="block text-slate-300 mb-2">Cron 表达式</label>
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
                                    <option value="">预设...</option>
                                    {CRON_PRESETS.map((preset) => (
                                        <option key={preset.value} value={preset.value}>{preset.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* 上次同步时间（可编辑） */}
                        <div>
                            <label className="block text-slate-300 mb-2">上次同步时间（修改可重新同步历史数据）</label>
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
                            保存配置
                        </button>
                    </div>
                </div>

                {/* 同步日志 */}
                <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-white">同步日志</h2>
                        <button onClick={loadLogs} disabled={loadingLogs} className="text-indigo-400 hover:text-indigo-300 text-sm">
                            {loadingLogs ? '刷新中...' : '刷新'}
                        </button>
                    </div>

                    {logs.length === 0 ? (
                        <p className="text-slate-400 text-center py-4">暂无同步记录</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-slate-400 border-b border-white/10">
                                        <th className="text-left py-2 px-2">时间</th>
                                        <th className="text-left py-2 px-2">类型</th>
                                        <th className="text-left py-2 px-2">状态</th>
                                        <th className="text-right py-2 px-2">新增</th>
                                        <th className="text-right py-2 px-2">更新</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log) => (
                                        <tr key={log.id} className="border-b border-white/5 text-slate-300">
                                            <td className="py-2 px-2">{formatTime(log.startTime)}</td>
                                            <td className="py-2 px-2">
                                                {log.triggerType === 'MANUAL' ? '手动' : '定时'}
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
