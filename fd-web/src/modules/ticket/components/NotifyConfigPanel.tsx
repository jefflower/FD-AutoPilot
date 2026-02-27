import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { configApi } from '../../../shared/services/serverApi';

interface NotifyConfigPanelProps {
    onClose: () => void;
}

type Platform = 'wecom' | 'dingtalk' | 'none';

const PLATFORMS: { id: Platform; color: string; icon: React.ReactNode }[] = [
    {
        id: 'wecom',
        color: 'emerald',
        icon: (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 12a10 10 0 0 1 10-10 10 10 0 0 1 10 10 10 10 0 0 1-10 10A10 10 0 0 1 2 12zm7.5-3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-7 7a.5.5 0 0 0 0 1c2.5 1.5 6.5 1.5 9 0a.5.5 0 1 0-.5-.87c-2.3 1.3-5.7 1.3-8 0a.5.5 0 0 0-.5-.13z" />
            </svg>
        ),
    },
    {
        id: 'dingtalk',
        color: 'blue',
        icon: (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18.25.25 0 0 0-.21-.02c-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-.04-.22-1.5-.66-1.07-.34-1.72-.52-1.66-.94.04-.22.44-.44 1.2-.67 4.7-2.05 7.84-3.4 9.44-4.05 4.5-1.88 5.44-2.21 6.05-2.22.13 0 .43.03.63.19.16.13.21.31.23.44-.01.1-.03.4-.04.55z" />
            </svg>
        ),
    },
    {
        id: 'none',
        color: 'slate',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
        ),
    },
];

const platformColors: Record<string, { selected: string; ring: string; text: string }> = {
    emerald: { selected: 'bg-emerald-500/15 border-emerald-500/40', ring: 'ring-emerald-500/30', text: 'text-emerald-400' },
    blue: { selected: 'bg-blue-500/15 border-blue-500/40', ring: 'ring-blue-500/30', text: 'text-blue-400' },
    slate: { selected: 'bg-slate-500/15 border-slate-500/40', ring: 'ring-slate-500/30', text: 'text-slate-400' },
};

const NotifyConfigPanel: React.FC<NotifyConfigPanelProps> = ({ onClose }) => {
    const { t } = useTranslation('tickets');

    const [platform, setPlatform] = useState<Platform>('none');
    const [webhookUrl, setWebhookUrl] = useState('');
    const [auditBaseUrl, setAuditBaseUrl] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

    useEffect(() => {
        configApi.getNotifyChannel()
            .then(cfg => {
                setPlatform((cfg.platform || 'none') as Platform);
                setWebhookUrl(cfg.webhookUrl || '');
                setAuditBaseUrl(cfg.auditBaseUrl || '');
            })
            .catch(() => {
                setToast({ type: 'error', msg: t('notifyConfig.loadFailed') });
            })
            .finally(() => setLoading(false));
    }, [t]);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            await configApi.setNotifyChannel({
                platform,
                webhookUrl,
                enabled: platform !== 'none',
                auditBaseUrl,
            });
            setToast({ type: 'success', msg: t('notifyConfig.saveSuccess') });
        } catch (err) {
            setToast({ type: 'error', msg: (err as Error).message });
        } finally {
            setSaving(false);
        }
    }, [platform, webhookUrl, auditBaseUrl, t]);

    const handleTest = useCallback(async () => {
        setTesting(true);
        try {
            const result = await configApi.testNotifyChannel();
            setToast({
                type: result.success ? 'success' : 'error',
                msg: result.success ? t('notifyConfig.testSuccess') : t('notifyConfig.testFailed'),
            });
        } catch (err) {
            setToast({ type: 'error', msg: t('notifyConfig.testError', { error: (err as Error).message }) });
        } finally {
            setTesting(false);
        }
    }, [t]);

    const activePlatform = PLATFORMS.find(p => p.id === platform)!;
    const activeColor = platformColors[activePlatform.color];

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
                <div>
                    <h3 className="text-sm font-bold text-white">{t('notifyConfig.title')}</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">{t('notifyConfig.desc')}</p>
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 text-slate-500 hover:text-white transition-colors rounded-lg hover:bg-slate-700/50"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* Content */}
            <div className="px-6 py-5 space-y-6 max-w-lg">
                {/* Platform selection */}
                <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-3">
                        {t('notifyConfig.platform')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                        {PLATFORMS.map(p => {
                            const colors = platformColors[p.color];
                            const isSelected = platform === p.id;
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => setPlatform(p.id)}
                                    className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border transition-all ${
                                        isSelected
                                            ? `${colors.selected} ${colors.text}`
                                            : 'border-slate-700/50 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                                    }`}
                                >
                                    {p.icon}
                                    <span className="text-[11px] font-bold">
                                        {t(`notifyConfig.${p.id === 'none' ? 'disabled' : p.id}`)}
                                    </span>
                                    <span className="text-[9px] opacity-60">
                                        {t(`notifyConfig.${p.id === 'none' ? 'disabledDesc' : p.id + 'Desc'}` as any)}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Webhook URL */}
                {platform !== 'none' && (
                    <div>
                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">
                            {t('notifyConfig.webhookUrl')}
                        </label>
                        <input
                            type="url"
                            value={webhookUrl}
                            onChange={e => setWebhookUrl(e.target.value)}
                            placeholder={t(`notifyConfig.webhookPlaceholder.${platform}`)}
                            className={`w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 ${activeColor.ring} focus:border-transparent transition-all`}
                        />
                    </div>
                )}

                {/* Audit base URL */}
                <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">
                        {t('notifyConfig.auditBaseUrl')}
                    </label>
                    <input
                        type="url"
                        value={auditBaseUrl}
                        onChange={e => setAuditBaseUrl(e.target.value)}
                        placeholder={t('notifyConfig.auditBaseUrlPlaceholder')}
                        className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 ring-indigo-500/30 focus:border-transparent transition-all"
                    />
                    <p className="text-[10px] text-slate-600 mt-1.5">{t('notifyConfig.auditBaseUrlHint')}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                    >
                        {saving ? t('notifyConfig.saving') : t('notifyConfig.save')}
                    </button>
                    {platform !== 'none' && (
                        <button
                            onClick={handleTest}
                            disabled={testing || !webhookUrl}
                            className="px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 text-xs font-bold rounded-lg transition-colors disabled:opacity-30"
                        >
                            {testing ? t('notifyConfig.testing') : t('notifyConfig.test')}
                        </button>
                    )}
                </div>
            </div>

            {/* Toast */}
            {toast && (
                <div className={`fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg text-xs font-medium shadow-lg transition-all ${
                    toast.type === 'success'
                        ? 'bg-emerald-600/90 text-white'
                        : 'bg-red-600/90 text-white'
                }`}>
                    {toast.msg}
                </div>
            )}
        </div>
    );
};

export default NotifyConfigPanel;
