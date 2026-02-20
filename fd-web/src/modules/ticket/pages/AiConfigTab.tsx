import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../../shared/hooks/useSettings';
import { userSettingsApi } from '../../../shared/services/serverApi';
import { isTauriEnv } from '../../../tauri/bridge';
import { DEFAULT_SELECTORS, SELECTORS_APP_CODE } from '../../../tauri/services/notebookShadow';
import type { NotebookLMConfig, AiTranslationConfig } from '../../../shared/types/server';

const AI_TRANSLATION_CONFIG_APP_CODE = 'ai-translation-config';

const DEFAULT_TRANSLATION_CONFIG: AiTranslationConfig = {
    provider: 'gemini-cli',
    geminiCliPath: 'gemini',
    geminiModel: 'gemini-2.0-flash',
    apiKey: '',
    apiEndpoint: '',
};

const AiConfigTab: React.FC = () => {
    const { t } = useTranslation(['settings', 'common']);
    const { notebookLMConfig, setNotebookLMConfig } = useSettings();
    const [toasts, setToasts] = useState<string[]>([]);

    // Translation engine config
    const [translationConfig, setTranslationConfig] = useState<AiTranslationConfig>(DEFAULT_TRANSLATION_CONFIG);
    const [translationConfigLoaded, setTranslationConfigLoaded] = useState(false);
    const translationSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // NotebookLM Selectors state
    const [selectors, setSelectors] = useState<Record<string, string> | null>(null);
    const [selectorsLoading, setSelectorsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Auto-dismiss toasts
    useEffect(() => {
        if (toasts.length === 0) return;
        const timer = setTimeout(() => setToasts(prev => prev.slice(1)), 3000);
        return () => clearTimeout(timer);
    }, [toasts]);

    // Load translation engine config from server
    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const raw = await userSettingsApi.getSettings(AI_TRANSLATION_CONFIG_APP_CODE);
                if (cancelled) return;
                if (raw) {
                    const parsed = JSON.parse(raw) as Partial<AiTranslationConfig>;
                    setTranslationConfig(prev => ({ ...prev, ...parsed }));
                }
            } catch {
                // Use defaults
            } finally {
                if (!cancelled) setTranslationConfigLoaded(true);
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    // Auto-save translation config (debounced)
    useEffect(() => {
        if (!translationConfigLoaded) return;
        if (translationSaveTimer.current) clearTimeout(translationSaveTimer.current);
        translationSaveTimer.current = setTimeout(async () => {
            try {
                await userSettingsApi.saveSettings(
                    AI_TRANSLATION_CONFIG_APP_CODE,
                    JSON.stringify(translationConfig)
                );
            } catch {
                // Silently fail
            }
        }, 800);
        return () => {
            if (translationSaveTimer.current) clearTimeout(translationSaveTimer.current);
        };
    }, [translationConfig, translationConfigLoaded]);

    // Load selectors
    const loadSelectors = useCallback(async () => {
        if (!isTauriEnv()) return;
        try {
            const raw = await userSettingsApi.getSettings(SELECTORS_APP_CODE);
            if (raw) {
                const custom = JSON.parse(raw) as Record<string, string>;
                setSelectors({ ...DEFAULT_SELECTORS, ...custom });
            } else {
                setSelectors({ ...DEFAULT_SELECTORS });
            }
        } catch {
            setSelectors({ ...DEFAULT_SELECTORS });
        }
    }, []);

    useEffect(() => {
        loadSelectors();
    }, [loadSelectors]);

    const handleResetSelectors = async () => {
        setSelectorsLoading(true);
        try {
            await userSettingsApi.deleteSettings(SELECTORS_APP_CODE);
            setSelectors({ ...DEFAULT_SELECTORS });
            setToasts(prev => [...prev, t('settings:selectors.resetSuccess')]);
        } catch (err) {
            setToasts(prev => [...prev, t('settings:selectors.resetFailed', { error: (err as Error).message })]);
        } finally {
            setSelectorsLoading(false);
        }
    };

    const handleUploadSelectors = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const parsed = JSON.parse(ev.target?.result as string);
                if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
                await userSettingsApi.saveSettings(SELECTORS_APP_CODE, JSON.stringify(parsed));
                setSelectors({ ...DEFAULT_SELECTORS, ...parsed });
                setToasts(prev => [...prev, t('settings:selectors.uploadSuccess')]);
            } catch {
                setToasts(prev => [...prev, t('settings:selectors.uploadInvalid')]);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const updateTranslationField = <K extends keyof AiTranslationConfig>(key: K, value: AiTranslationConfig[K]) => {
        setTranslationConfig(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="flex-1 p-6 overflow-auto">
            <div className="max-w-3xl mx-auto w-full">
                <header className="mb-6">
                    <h1 className="text-2xl font-bold text-white mb-1">{t('settings:aiConfig.title')}</h1>
                    <p className="text-slate-400 text-sm">{t('settings:aiConfig.subtitle')}</p>
                </header>

                <div className="space-y-6 pb-12">

                    {/* ====== 翻译引擎 ====== */}
                    <div className="flex items-center gap-3">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                            {t('settings:aiConfig.sections.translation')}
                        </span>
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                    </div>

                    {/* Provider Selector */}
                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="w-1 h-4 bg-blue-500 rounded-full"></span>
                            {t('settings:aiConfig.translation.provider')}
                        </h3>
                        <p className="text-[10px] text-slate-500 mb-5">{t('settings:aiConfig.translation.providerHint')}</p>

                        <div className="grid grid-cols-2 gap-3 mb-6">
                            {[
                                { id: 'gemini-cli', label: t('settings:aiConfig.translation.geminiCli'), desc: t('settings:aiConfig.translation.geminiCliDesc'), color: 'blue' },
                                { id: 'gemini-api', label: t('settings:aiConfig.translation.geminiApi'), desc: t('settings:aiConfig.translation.geminiApiDesc'), color: 'purple' },
                            ].map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => updateTranslationField('provider', opt.id)}
                                    className={`p-4 rounded-xl border text-left transition-all ${
                                        translationConfig.provider === opt.id
                                            ? `bg-${opt.color}-500/15 border-${opt.color}-500/50`
                                            : 'bg-slate-800/30 border-white/10 hover:bg-white/5'
                                    }`}
                                >
                                    <div className={`text-sm font-bold mb-1 ${
                                        translationConfig.provider === opt.id ? `text-${opt.color}-400` : 'text-slate-300'
                                    }`}>
                                        {opt.label}
                                    </div>
                                    <div className="text-[10px] text-slate-500 leading-relaxed">{opt.desc}</div>
                                </button>
                            ))}
                        </div>

                        {/* Gemini CLI Config */}
                        {translationConfig.provider === 'gemini-cli' && (
                            <div className="space-y-4 pt-2 border-t border-white/5">
                                <div className="pt-4">
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">
                                        {t('settings:aiConfig.translation.geminiCliPath')}
                                    </label>
                                    <input
                                        type="text"
                                        value={translationConfig.geminiCliPath || ''}
                                        onChange={e => updateTranslationField('geminiCliPath', e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono"
                                        placeholder={t('settings:aiConfig.translation.geminiCliPathPlaceholder')}
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1.5">{t('settings:aiConfig.translation.geminiCliPathHint')}</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">
                                        {t('settings:aiConfig.translation.geminiModel')}
                                    </label>
                                    <input
                                        type="text"
                                        value={translationConfig.geminiModel || ''}
                                        onChange={e => updateTranslationField('geminiModel', e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono"
                                        placeholder={t('settings:aiConfig.translation.geminiModelPlaceholder')}
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1.5">{t('settings:aiConfig.translation.geminiModelHint')}</p>
                                </div>
                            </div>
                        )}

                        {/* Gemini API Config */}
                        {translationConfig.provider === 'gemini-api' && (
                            <div className="space-y-4 pt-2 border-t border-white/5">
                                <div className="pt-4">
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">
                                        {t('settings:aiConfig.translation.apiKey')}
                                    </label>
                                    <input
                                        type="password"
                                        value={translationConfig.apiKey || ''}
                                        onChange={e => updateTranslationField('apiKey', e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono"
                                        placeholder={t('settings:aiConfig.translation.apiKeyPlaceholder')}
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1.5">{t('settings:aiConfig.translation.apiKeyHint')}</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">
                                        {t('settings:aiConfig.translation.geminiModel')}
                                    </label>
                                    <input
                                        type="text"
                                        value={translationConfig.geminiModel || ''}
                                        onChange={e => updateTranslationField('geminiModel', e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono"
                                        placeholder={t('settings:aiConfig.translation.geminiModelPlaceholder')}
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1.5">{t('settings:aiConfig.translation.geminiModelHint')}</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">
                                        {t('settings:aiConfig.translation.apiEndpoint')}
                                    </label>
                                    <input
                                        type="text"
                                        value={translationConfig.apiEndpoint || ''}
                                        onChange={e => updateTranslationField('apiEndpoint', e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono"
                                        placeholder={t('settings:aiConfig.translation.apiEndpointPlaceholder')}
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1.5">{t('settings:aiConfig.translation.apiEndpointHint')}</p>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* ====== 回复引擎 ====== */}
                    <div className="flex items-center gap-3 mt-2">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                            {t('settings:aiConfig.sections.reply')}
                        </span>
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                    </div>

                    <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
                            <span className="w-1 h-4 bg-purple-500 rounded-full"></span>
                            {t('settings:ai.title')}
                        </h3>

                        <div className="space-y-5">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:ai.notebookUrl')}</label>
                                    <input
                                        type="text"
                                        value={notebookLMConfig.notebookUrl || ''}
                                        onChange={(e) => {
                                            const url = e.target.value;
                                            const updates: Partial<NotebookLMConfig> = { notebookUrl: url };
                                            const match = url.match(/\/notebook\/([a-f0-9-]+)/);
                                            if (match) {
                                                updates.notebookId = match[1];
                                            }
                                            setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, ...updates }));
                                        }}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                        placeholder={t('settings:ai.notebookUrlPlaceholder')}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:ai.notebookId')}</label>
                                    <input
                                        type="text"
                                        value={notebookLMConfig.notebookId}
                                        onChange={(e) => setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, notebookId: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">{t('settings:ai.promptTemplate')}</label>
                                <textarea
                                    value={notebookLMConfig.prompt}
                                    onChange={(e) => setNotebookLMConfig((prev: NotebookLMConfig) => ({ ...prev, prompt: e.target.value }))}
                                    className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                    placeholder={t('settings:ai.promptPlaceholder')}
                                    rows={3}
                                />
                            </div>
                        </div>
                    </section>

                    {/* ====== NotebookLM Selectors (Tauri only) ====== */}
                    {isTauriEnv() && (
                        <>
                            <div className="flex items-center gap-3 mt-2">
                                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                                    {t('settings:aiConfig.sections.selectors')}
                                </span>
                                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                            </div>

                            <section className="bg-white/5 rounded-xl border border-white/10 p-6">
                                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <span className="w-1 h-4 bg-teal-500 rounded-full"></span>
                                    {t('settings:selectors.title')}
                                </h3>
                                <p className="text-[10px] text-slate-500 mb-5">{t('settings:selectors.description')}</p>

                                {selectors && (
                                    <pre className="w-full p-4 bg-slate-900/60 border border-white/5 rounded-lg text-[11px] text-slate-400 font-mono overflow-auto max-h-64 mb-5 select-all">
                                        {JSON.stringify(selectors, null, 2)}
                                    </pre>
                                )}

                                <div className="flex gap-3">
                                    <button
                                        onClick={handleResetSelectors}
                                        disabled={selectorsLoading}
                                        className="px-4 py-2 bg-teal-600/80 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all"
                                    >
                                        {t('settings:selectors.resetToDefault')}
                                    </button>
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white text-xs font-bold rounded-lg transition-all border border-white/10"
                                    >
                                        {t('settings:selectors.uploadConfig')}
                                    </button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".json"
                                        className="hidden"
                                        onChange={handleUploadSelectors}
                                    />
                                </div>
                            </section>
                        </>
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
            </div>
        </div>
    );
};

export default AiConfigTab;
