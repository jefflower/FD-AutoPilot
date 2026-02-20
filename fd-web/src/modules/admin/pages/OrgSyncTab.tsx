import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { orgSyncApi } from '../../../shared/services/serverApi';
import type { OrgSyncConfig, OrgSyncResult, OrgSyncLog, SysDepartment } from '../../../shared/types/server';

const PLATFORMS = ['dingtalk', 'wecom', 'none'] as const;
const ROLES = ['USER', 'AUDITOR', 'ADMIN'] as const;

const OrgSyncTab: React.FC = () => {
    const { t } = useTranslation(['orgSync', 'common']);
    const [config, setConfig] = useState<OrgSyncConfig | null>(null);
    const [logs, setLogs] = useState<OrgSyncLog[]>([]);
    const [departments, setDepartments] = useState<SysDepartment[]>([]);
    const [syncResult, setSyncResult] = useState<OrgSyncResult | null>(null);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [toasts, setToasts] = useState<string[]>([]);

    const addToast = (msg: string) => setToasts(prev => [...prev, msg]);

    const loadData = useCallback(async () => {
        try {
            const [cfg, logList, depts] = await Promise.all([
                orgSyncApi.getConfig(),
                orgSyncApi.getSyncLogs(),
                orgSyncApi.getDepartments(),
            ]);
            setConfig(cfg);
            setLogs(logList);
            setDepartments(depts);
        } catch {
            // 服务不可用时静默
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const handleSave = async () => {
        if (!config) return;
        setSaving(true);
        try {
            await orgSyncApi.saveConfig(config);
            addToast(t('orgSync:message.saveSuccess'));
        } catch (err) {
            addToast(t('orgSync:message.saveFailed', { error: (err as Error).message }));
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        try {
            const result = await orgSyncApi.testConnection();
            addToast(result.success ? t('orgSync:message.testSuccess') : t('orgSync:message.testFailed'));
        } catch {
            addToast(t('orgSync:message.testFailed'));
        } finally {
            setTesting(false);
        }
    };

    const handleSync = async () => {
        setSyncing(true);
        setSyncResult(null);
        try {
            const result = await orgSyncApi.triggerSync();
            setSyncResult(result);
            addToast(t('orgSync:message.syncSuccess'));
            // 刷新日志和部门
            const [logList, depts] = await Promise.all([orgSyncApi.getSyncLogs(), orgSyncApi.getDepartments()]);
            setLogs(logList);
            setDepartments(depts);
        } catch (err) {
            addToast(t('orgSync:message.syncFailed', { error: (err as Error).message }));
        } finally {
            setSyncing(false);
        }
    };

    if (!config) {
        return <div className="flex-1 p-6 flex items-center justify-center text-slate-500">{t('common:button.loading')}</div>;
    }

    const platform = config.orgSyncPlatform;
    const platformColor = platform === 'dingtalk' ? 'blue' : platform === 'wecom' ? 'green' : 'slate';

    return (
        <div className="flex-1 p-6 overflow-auto">
            <div className="max-w-3xl mx-auto w-full">
                <header className="mb-6">
                    <h1 className="text-2xl font-bold text-white mb-1">{t('orgSync:title')}</h1>
                    <p className="text-slate-400 text-sm">{t('orgSync:subtitle')}</p>
                </header>

                <div className="space-y-6 pb-12">

                    {/* 平台选择 */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">{t('orgSync:platform.label')}</h3>
                        <div className="flex gap-2 mb-5">
                            {PLATFORMS.map(p => (
                                <button
                                    key={p}
                                    onClick={() => setConfig({ ...config, orgSyncPlatform: p })}
                                    className={`flex-1 py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                                        platform === p
                                            ? p === 'dingtalk' ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                                              : p === 'wecom' ? 'bg-green-500/20 border-green-500/50 text-green-400'
                                              : 'bg-slate-500/20 border-slate-500/50 text-slate-400'
                                            : 'bg-slate-800/50 border-white/10 text-slate-500 hover:bg-white/10'
                                    }`}
                                >
                                    {t(`orgSync:platform.${p}`)}
                                </button>
                            ))}
                        </div>

                        {/* OAuth 开关 */}
                        {platform !== 'none' && (
                            <div className={`flex items-center justify-between p-4 rounded-lg border mb-5 ${
                                platformColor === 'blue' ? 'bg-blue-500/5 border-blue-500/10' : 'bg-green-500/5 border-green-500/10'
                            }`}>
                                <div>
                                    <p className="text-sm text-white font-medium">{t('orgSync:oauth.label')}</p>
                                    <p className="text-[10px] text-slate-500 mt-1">{t('orgSync:oauth.desc')}</p>
                                </div>
                                <button
                                    onClick={() => setConfig({ ...config, oauthEnabled: !config.oauthEnabled })}
                                    className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                                        config.oauthEnabled
                                            ? (platformColor === 'blue' ? 'bg-blue-500' : 'bg-green-500')
                                            : 'bg-slate-600'
                                    }`}
                                >
                                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                                        config.oauthEnabled ? 'translate-x-6' : 'translate-x-0.5'
                                    }`} />
                                </button>
                            </div>
                        )}

                        {/* 默认角色 */}
                        {platform !== 'none' && (
                            <div className="mb-5">
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('orgSync:defaultRole.label')}</label>
                                <select
                                    value={config.defaultSyncRole}
                                    onChange={e => setConfig({ ...config, defaultSyncRole: e.target.value })}
                                    className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 appearance-none"
                                >
                                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                                <p className="text-[10px] text-slate-500 mt-1">{t('orgSync:defaultRole.hint')}</p>
                            </div>
                        )}
                    </section>

                    {/* 平台配置表单 */}
                    {platform === 'dingtalk' && (
                        <section className="bg-white/5 rounded-xl border border-white/10 p-6 space-y-4">
                            <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wider mb-2">{t('orgSync:platform.dingtalk')}</h3>
                            {([
                                ['dingtalkAppKey', 'dingtalk.appKey', false],
                                ['dingtalkAppSecret', 'dingtalk.appSecret', true],
                                ['dingtalkCorpId', 'dingtalk.corpId', false],
                                ['dingtalkRootDeptId', 'dingtalk.rootDeptId', false],
                            ] as const).map(([field, label, isSecret]) => (
                                <div key={field}>
                                    <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">{t(`orgSync:${label}`)}</label>
                                    <input
                                        type={isSecret ? 'password' : 'text'}
                                        value={(config as any)[field] || ''}
                                        onChange={e => setConfig({ ...config, [field]: e.target.value })}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                        placeholder={field === 'dingtalkRootDeptId' ? '1' : ''}
                                    />
                                    {field === 'dingtalkRootDeptId' && (
                                        <p className="text-[10px] text-slate-500 mt-1">{t('orgSync:dingtalk.rootDeptHint')}</p>
                                    )}
                                </div>
                            ))}
                        </section>
                    )}

                    {platform === 'wecom' && (
                        <section className="bg-white/5 rounded-xl border border-white/10 p-6 space-y-4">
                            <h3 className="text-sm font-bold text-green-400 uppercase tracking-wider mb-2">{t('orgSync:platform.wecom')}</h3>
                            {([
                                ['wecomCorpId', 'wecom.corpId', false],
                                ['wecomAgentId', 'wecom.agentId', false],
                                ['wecomSecret', 'wecom.secret', true],
                                ['wecomRootDeptId', 'wecom.rootDeptId', false],
                            ] as const).map(([field, label, isSecret]) => (
                                <div key={field}>
                                    <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">{t(`orgSync:${label}`)}</label>
                                    <input
                                        type={isSecret ? 'password' : 'text'}
                                        value={(config as any)[field] || ''}
                                        onChange={e => setConfig({ ...config, [field]: e.target.value })}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500/50"
                                        placeholder={field === 'wecomRootDeptId' ? '1' : ''}
                                    />
                                    {field === 'wecomRootDeptId' && (
                                        <p className="text-[10px] text-slate-500 mt-1">{t('orgSync:wecom.rootDeptHint')}</p>
                                    )}
                                </div>
                            ))}
                        </section>
                    )}

                    {/* 操作按钮 */}
                    {platform !== 'none' && (
                        <div className="flex gap-3">
                            <button onClick={handleSave} disabled={saving}
                                className={`px-5 py-2 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50 ${
                                    platformColor === 'blue' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-green-600 hover:bg-green-500'
                                }`}>
                                {saving ? t('common:button.saving') : t('orgSync:actions.saveConfig')}
                            </button>
                            <button onClick={handleTest} disabled={testing}
                                className="px-5 py-2 bg-slate-700/50 hover:bg-slate-600/50 disabled:opacity-30 text-slate-300 hover:text-white text-xs font-bold rounded-lg transition-all border border-white/10">
                                {testing ? t('orgSync:actions.testing') : t('orgSync:actions.testConnection')}
                            </button>
                            <button onClick={handleSync} disabled={syncing}
                                className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all">
                                {syncing ? t('orgSync:actions.syncing') : t('orgSync:actions.triggerSync')}
                            </button>
                        </div>
                    )}

                    {/* 同步结果 */}
                    {syncResult && (
                        <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                            <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-4">{t('orgSync:result.title')}</h3>
                            <div className="grid grid-cols-3 gap-4">
                                {([
                                    ['deptCreated', syncResult.departmentsCreated, 'text-green-400'],
                                    ['deptUpdated', syncResult.departmentsUpdated, 'text-blue-400'],
                                    ['userCreated', syncResult.usersCreated, 'text-green-400'],
                                    ['userUpdated', syncResult.usersUpdated, 'text-blue-400'],
                                    ['userSkipped', syncResult.usersSkipped, 'text-slate-400'],
                                    ['duration', `${syncResult.durationMs}ms`, 'text-slate-400'],
                                ] as const).map(([key, value, color]) => (
                                    <div key={key} className="text-center">
                                        <div className={`text-2xl font-bold ${color}`}>{value}</div>
                                        <div className="text-[10px] text-slate-500 mt-1">{t(`orgSync:result.${key}`)}</div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* 同步日志 */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">{t('orgSync:logs.title')}</h3>
                        {logs.length === 0 ? (
                            <p className="text-slate-500 text-sm">{t('orgSync:logs.noLogs')}</p>
                        ) : (
                            <div className="space-y-2 max-h-64 overflow-auto">
                                {logs.map(log => (
                                    <div key={log.id} className="flex items-center gap-3 py-2 px-3 bg-slate-800/30 rounded-lg text-xs">
                                        <span className={`px-2 py-0.5 rounded-full font-bold ${
                                            log.status === 'SUCCESS' ? 'bg-green-500/20 text-green-400'
                                            : log.status === 'FAILED' ? 'bg-red-500/20 text-red-400'
                                            : 'bg-amber-500/20 text-amber-400'
                                        }`}>
                                            {t(`orgSync:status.${log.status}`)}
                                        </span>
                                        <span className="text-slate-400">{log.platform}</span>
                                        <span className="text-slate-500">{log.triggerUser}</span>
                                        <span className="text-slate-600 ml-auto">
                                            {log.startTime ? new Date(log.startTime).toLocaleString() : '-'}
                                        </span>
                                        {log.status === 'SUCCESS' && (
                                            <span className="text-slate-500">
                                                +{log.usersCreated} ~{log.usersUpdated}
                                            </span>
                                        )}
                                        {log.errorMessage && (
                                            <span className="text-red-400 truncate max-w-48" title={log.errorMessage}>
                                                {log.errorMessage}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* 部门预览 */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">{t('orgSync:departments.title')}</h3>
                        {departments.length === 0 ? (
                            <p className="text-slate-500 text-sm">{t('orgSync:departments.noDepts')}</p>
                        ) : (
                            <div className="space-y-1 max-h-64 overflow-auto">
                                {departments
                                    .sort((a, b) => (a.path || '').localeCompare(b.path || ''))
                                    .map(dept => {
                                        const depth = dept.path ? dept.path.split('/').filter(Boolean).length - 1 : 0;
                                        return (
                                            <div key={dept.id} className="flex items-center gap-2 py-1 text-xs" style={{ paddingLeft: `${depth * 20}px` }}>
                                                <span className="text-slate-500">{'└'}</span>
                                                <span className="text-slate-300">{dept.name}</span>
                                                <span className="text-slate-600 text-[10px]">({dept.externalId})</span>
                                            </div>
                                        );
                                    })
                                }
                            </div>
                        )}
                    </section>
                </div>

                {/* Toast */}
                {toasts.length > 0 && (
                    <div className="fixed bottom-4 right-4 space-y-2 z-50">
                        {toasts.slice(-3).map((msg, i) => (
                            <div key={i} className="bg-slate-900/90 backdrop-blur border border-white/10 rounded-lg px-4 py-2 shadow-2xl animate-fade-in">
                                <span className="text-[11px] text-slate-300 font-medium">{msg}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default OrgSyncTab;
