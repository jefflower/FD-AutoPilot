import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { configApi } from '../../../shared/services/serverApi';

interface SettingsTabProps {
    serverUrl: string;
    setServerUrl: (s: string) => void;
    translationLang: string;
    setTranslationLang: (s: string) => void;
}

const PLATFORMS = ['wecom', 'dingtalk', 'none'] as const;

const SettingsTab: React.FC<SettingsTabProps> = ({
    serverUrl, setServerUrl,
    translationLang, setTranslationLang,
}) => {
    const { t, i18n } = useTranslation(['settings', 'common']);
    const [toasts, setToasts] = useState<string[]>([]);

    // 通知渠道配置状态
    const [platform, setPlatform] = useState<string>('wecom');
    const [webhookUrl, setWebhookUrl] = useState('');
    const [notifyEnabled, setNotifyEnabled] = useState(false);
    const [auditBaseUrl, setAuditBaseUrl] = useState('');
    const [notifyLoading, setNotifyLoading] = useState(false);
    const [notifyTesting, setNotifyTesting] = useState(false);
    const [configLoaded, setConfigLoaded] = useState(false);

    const loadServerConfig = useCallback(async () => {
        try {
            const config = await configApi.getNotifyChannel();
            setPlatform(config.platform || 'wecom');
            setWebhookUrl(config.webhookUrl || '');
            setNotifyEnabled(config.enabled);
            setAuditBaseUrl(config.auditBaseUrl || '');
            setConfigLoaded(true);
        } catch {
            // 服务端不可用时静默忽略
        }
    }, []);

    useEffect(() => {
        loadServerConfig();
    }, [loadServerConfig]);

    const handleSaveNotify = async () => {
        setNotifyLoading(true);
        try {
            await configApi.setNotifyChannel({
                platform,
                webhookUrl,
                enabled: notifyEnabled,
                auditBaseUrl,
            });
            setToasts(prev => [...prev, t('settings:notify.saveSuccess')]);
        } catch (err) {
            setToasts(prev => [...prev, t('common:message.saveFailed', { error: (err as Error).message })]);
        } finally {
            setNotifyLoading(false);
        }
    };

    const handleTestNotify = async () => {
        setNotifyTesting(true);
        try {
            const result = await configApi.testNotifyChannel();
            if (result.success) {
                setToasts(prev => [...prev, t('settings:notify.testSuccess')]);
            } else {
                setToasts(prev => [...prev, t('settings:notify.testFailed')]);
            }
        } catch (err) {
            setToasts(prev => [...prev, t('settings:notify.testError', { error: (err as Error).message })]);
        } finally {
            setNotifyTesting(false);
        }
    };

    const platformColor = platform === 'dingtalk' ? 'blue' : platform === 'wecom' ? 'green' : 'slate';

    return (
        <div className="flex-1 p-6 overflow-auto">
            <div className="max-w-3xl mx-auto w-full">
                <header className="mb-6">
                    <h1 className="text-2xl font-bold text-white mb-1">{t('settings:title')}</h1>
                    <p className="text-slate-400 text-sm">{t('settings:subtitle')}</p>
                </header>

                <div className="space-y-6 pb-12">

                    {/* ====== 本地配置 (Local Settings) ====== */}
                    <div className="flex items-center gap-3 mt-2">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">{t('settings:sections.local')}</span>
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                    </div>

                    {/* Language Settings */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                            <span className="w-1 h-4 bg-amber-500 rounded-full"></span>
                            {t('settings:language.title')}
                        </h3>
                        <div className="flex gap-3">
                            {[
                                { code: 'zh-CN', label: '简体中文' },
                                { code: 'en-US', label: 'English' },
                            ].map(lang => (
                                <button
                                    key={lang.code}
                                    onClick={() => i18n.changeLanguage(lang.code)}
                                    className={`flex-1 py-3 px-4 rounded-xl border text-sm font-medium transition-all ${
                                        i18n.language === lang.code
                                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                                            : 'bg-slate-800/50 border-white/10 text-slate-400 hover:bg-white/10'
                                    }`}
                                >
                                    {lang.label}
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Connection Settings */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                            <span className="w-1 h-4 bg-indigo-500 rounded-full"></span>
                            {t('settings:connection.title')}
                        </h3>

                        <div className="space-y-5">
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:connection.serverUrl')}</label>
                                <input
                                    type="text"
                                    value={serverUrl}
                                    onChange={(e) => setServerUrl(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono text-sm"
                                    placeholder={t('settings:connection.serverUrlPlaceholder')}
                                />
                                <p className="text-[10px] text-slate-500 mt-2">{t('settings:connection.serverUrlHint')}</p>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:connection.translationLang')}</label>
                                <select
                                    value={translationLang}
                                    onChange={(e) => setTranslationLang(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm appearance-none"
                                >
                                    <option value="cn">{t('settings:connection.langOptionCn')}</option>
                                    <option value="en">{t('settings:connection.langOptionEn')}</option>
                                    <option value="jp">{t('settings:connection.langOptionJp')}</option>
                                </select>
                                <p className="text-[10px] text-slate-500 mt-2">{t('settings:connection.translationLangHint')}</p>
                            </div>
                        </div>
                    </section>

                    {/* ====== 云端配置 (Cloud Settings) ====== */}
                    <div className="flex items-center gap-3 mt-2">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">{t('settings:sections.cloud')}</span>
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                    </div>

                    {/* Notification Channel */}
                    {configLoaded && (
                        <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                                <span className={`w-1 h-4 rounded-full ${
                                    platformColor === 'green' ? 'bg-green-500' :
                                    platformColor === 'blue' ? 'bg-blue-500' : 'bg-slate-500'
                                }`}></span>
                                {t('settings:notify.title')}
                            </h3>
                            <div className="space-y-5">
                                {/* Platform Selection */}
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-3 uppercase">{t('settings:notify.platform')}</label>
                                    <div className="flex gap-2">
                                        {PLATFORMS.map(p => (
                                            <button
                                                key={p}
                                                onClick={() => setPlatform(p)}
                                                className={`flex-1 py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                                                    platform === p
                                                        ? p === 'wecom' ? 'bg-green-500/20 border-green-500/50 text-green-400'
                                                          : p === 'dingtalk' ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                                                          : 'bg-slate-500/20 border-slate-500/50 text-slate-400'
                                                        : 'bg-slate-800/50 border-white/10 text-slate-500 hover:bg-white/10'
                                                }`}
                                            >
                                                {t(`settings:notify.platformOption.${p}`)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Enable Toggle (only for wecom/dingtalk) */}
                                {platform !== 'none' && (
                                    <div className={`flex items-center justify-between p-4 rounded-lg border ${
                                        platformColor === 'green' ? 'bg-green-500/5 border-green-500/10'
                                            : 'bg-blue-500/5 border-blue-500/10'
                                    }`}>
                                        <div>
                                            <p className="text-sm text-white font-medium">{t('settings:notify.enableNotify')}</p>
                                            <p className="text-[10px] text-slate-500 mt-1">{t('settings:notify.enableNotifyDesc')}</p>
                                        </div>
                                        <button
                                            onClick={() => setNotifyEnabled(!notifyEnabled)}
                                            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                                                notifyEnabled
                                                    ? (platformColor === 'green' ? 'bg-green-500' : 'bg-blue-500')
                                                    : 'bg-slate-600'
                                            }`}
                                        >
                                            <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                                                notifyEnabled ? 'translate-x-6' : 'translate-x-0.5'
                                            }`} />
                                        </button>
                                    </div>
                                )}

                                {/* Webhook URL (only for wecom/dingtalk) */}
                                {platform !== 'none' && (
                                    <div>
                                        <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:notify.webhookUrl')}</label>
                                        <input
                                            type="text"
                                            value={webhookUrl}
                                            onChange={(e) => setWebhookUrl(e.target.value)}
                                            className={`w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 font-mono ${
                                                platformColor === 'green' ? 'focus:ring-green-500/50' : 'focus:ring-blue-500/50'
                                            }`}
                                            placeholder={t(`settings:notify.webhookPlaceholder.${platform}` as any)}
                                        />
                                    </div>
                                )}

                                {/* Audit Base URL */}
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:notify.auditBaseUrl')}</label>
                                    <input
                                        type="text"
                                        value={auditBaseUrl}
                                        onChange={(e) => setAuditBaseUrl(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
                                        placeholder="https://fd.example.com"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-2">{t('settings:notify.auditBaseUrlHint')}</p>
                                </div>

                                {/* Save & Test */}
                                <div className="flex gap-3">
                                    <button
                                        onClick={handleSaveNotify}
                                        disabled={notifyLoading}
                                        className={`px-5 py-2 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50 ${
                                            platformColor === 'green' ? 'bg-green-600 hover:bg-green-500'
                                                : platformColor === 'blue' ? 'bg-blue-600 hover:bg-blue-500'
                                                : 'bg-slate-600 hover:bg-slate-500'
                                        }`}
                                    >
                                        {notifyLoading ? t('common:button.saving') : t('settings:notify.saveConfig')}
                                    </button>
                                    {platform !== 'none' && (
                                        <button
                                            onClick={handleTestNotify}
                                            disabled={notifyTesting || !webhookUrl}
                                            className="px-5 py-2 bg-slate-700/50 hover:bg-slate-600/50 disabled:opacity-30 text-slate-300 hover:text-white text-xs font-bold rounded-lg transition-all border border-white/10"
                                        >
                                            {notifyTesting ? t('settings:notify.sending') : t('settings:notify.sendTestMessage')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </section>
                    )}

                </div>

                {/* Toast Notifications */}
                {toasts.length > 0 && (
                    <div className="fixed bottom-4 right-4 space-y-2 z-50">
                        {toasts.slice(-3).map((msg, i) => (
                            <div key={i} className="bg-slate-900/90 backdrop-blur border border-white/10 rounded-lg px-4 py-2 shadow-2xl animate-fade-in">
                                <span className="text-[11px] text-slate-300 font-medium">{msg}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Footer Status */}
                <div className="fixed bottom-0 left-0 right-0 p-4 pointer-events-none">
                    <div className="max-w-3xl mx-auto flex justify-end">
                        <div className="bg-slate-900/90 backdrop-blur border border-white/10 rounded-full px-4 py-2 flex items-center gap-2 shadow-2xl">
                            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            <span className="text-[11px] text-slate-300 font-medium">{t('settings:footer.savedToLocal')}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsTab;
