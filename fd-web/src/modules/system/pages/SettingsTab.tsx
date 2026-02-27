import React from 'react';
import { useTranslation } from 'react-i18next';

interface SettingsTabProps {
    serverUrl: string;
    setServerUrl: (s: string) => void;
    translationLang: string;
    setTranslationLang: (s: string) => void;
}

const SettingsTab: React.FC<SettingsTabProps> = ({
    serverUrl, setServerUrl,
    translationLang, setTranslationLang,
}) => {
    const { t, i18n } = useTranslation(['settings', 'common']);

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

                </div>

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
