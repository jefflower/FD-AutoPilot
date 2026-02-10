import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import SqlQueryPanel from './SqlQueryPanel';
import H2ConsolePanel from './H2ConsolePanel';

type DbMode = 'sql' | 'h2console';

const DatabaseTab: React.FC = () => {
    const { t } = useTranslation(['admin', 'common']);
    const [mode, setMode] = useState<DbMode>('sql');

    return (
        <div className="flex-1 flex flex-col min-w-0 p-4 gap-3">
            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">{t('database.title')}</h2>
                <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/10">
                    <button
                        onClick={() => setMode('sql')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                            mode === 'sql'
                                ? 'bg-indigo-500/20 text-indigo-400'
                                : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        {t('database.sqlQuery')}
                    </button>
                    <button
                        onClick={() => setMode('h2console')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                            mode === 'h2console'
                                ? 'bg-indigo-500/20 text-indigo-400'
                                : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        {t('database.h2Console')}
                    </button>
                </div>
            </div>

            {/* 模式内容 */}
            {mode === 'sql' ? <SqlQueryPanel /> : <H2ConsolePanel />}
        </div>
    );
};

export default DatabaseTab;
