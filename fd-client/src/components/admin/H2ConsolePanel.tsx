import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const H2ConsolePanel: React.FC = () => {
    const { t } = useTranslation(['admin', 'common']);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    return (
        <div className="flex-1 flex flex-col gap-3 min-h-0">
            {/* 连接信息提示 */}
            <div className="px-4 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-xs text-slate-400 flex items-center gap-4 flex-wrap">
                <span>
                    {t('database.h2.jdbcUrl')} <code className="text-indigo-400">jdbc:h2:file:/var/lib/h2/db</code>
                </span>
                <span>
                    {t('database.h2.username')} <code className="text-indigo-400">sa</code>
                </span>
                <span>
                    {t('database.h2.password')} <code className="text-indigo-400">password</code>
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-500">
                    {t('database.h2.hint')}
                </span>
            </div>

            {/* iframe */}
            <div className="flex-1 rounded-xl overflow-hidden border border-white/10 relative min-h-0">
                {loading && !error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10">
                        <div className="flex items-center gap-2 text-slate-400">
                            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            {t('database.h2.loading')}
                        </div>
                    </div>
                )}
                {error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10">
                        <div className="text-center">
                            <svg className="w-12 h-12 mx-auto mb-3 text-red-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                            <p className="text-red-400 mb-1">{t('database.h2.loadFailed')}</p>
                            <p className="text-slate-500 text-xs">{t('database.h2.loadFailedHint')}</p>
                            <button
                                onClick={() => { setError(false); setLoading(true); }}
                                className="mt-3 px-4 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                            >
                                {t('database.h2.retry')}
                            </button>
                        </div>
                    </div>
                )}
                <iframe
                    src="http://localhost:9988/h2-console"
                    className="w-full h-full bg-white"
                    onLoad={() => setLoading(false)}
                    onError={() => { setLoading(false); setError(true); }}
                    title="H2 Database Console"
                />
            </div>
        </div>
    );
};

export default H2ConsolePanel;
