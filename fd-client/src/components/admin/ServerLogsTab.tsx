/**
 * 服务端日志查看组件 (管理员专属)
 * 通过 Actuator /logfile 端点获取日志内容
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { actuatorApi } from '../../services/serverApi';

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
    ERROR: 'text-red-400',
    WARN: 'text-yellow-400',
    INFO: 'text-green-400',
    DEBUG: 'text-slate-400',
    TRACE: 'text-slate-500',
};

const SIZE_OPTIONS = [
    { label: '100 KB', value: 100 },
    { label: '200 KB', value: 200 },
    { label: '500 KB', value: 500 },
    { label: '1 MB', value: 1024 },
];

const LEVEL_OPTIONS: (LogLevel | 'ALL')[] = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];

function detectLogLevel(line: string): LogLevel | null {
    if (/\bERROR\b/.test(line)) return 'ERROR';
    if (/\bWARN\b/.test(line)) return 'WARN';
    if (/\bINFO\b/.test(line)) return 'INFO';
    if (/\bDEBUG\b/.test(line)) return 'DEBUG';
    if (/\bTRACE\b/.test(line)) return 'TRACE';
    return null;
}

const ServerLogsTab: React.FC = () => {
    const { t } = useTranslation(['admin', 'common']);
    const [logText, setLogText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [autoRefresh, setAutoRefresh] = useState(true);
    const [sizeKB, setSizeKB] = useState(200);
    const [levelFilter, setLevelFilter] = useState<LogLevel | 'ALL'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [autoScroll, setAutoScroll] = useState(true);

    const [showLoggerPanel, setShowLoggerPanel] = useState(false);
    const [loggers, setLoggers] = useState<Record<string, { configuredLevel: string | null; effectiveLevel: string }>>({});
    const [loggerFilter, setLoggerFilter] = useState('com.jefflower');
    const [loggerLoading, setLoggerLoading] = useState(false);

    const logContainerRef = useRef<HTMLDivElement>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchLogs = useCallback(async () => {
        try {
            setError(null);
            const text = await actuatorApi.fetchLogfile(sizeKB);
            setLogText(text);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('logs.fetchFailed'));
        }
    }, [sizeKB, t]);

    useEffect(() => {
        setLoading(true);
        fetchLogs().finally(() => setLoading(false));
    }, [fetchLogs]);

    useEffect(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (autoRefresh) {
            intervalRef.current = setInterval(fetchLogs, 3000);
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [autoRefresh, fetchLogs]);

    useEffect(() => {
        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logText, autoScroll]);

    const processedLines = React.useMemo(() => {
        if (!logText) return [];
        const lines = logText.split('\n');
        return lines
            .map(line => ({ text: line, level: detectLogLevel(line) }))
            .filter(({ text, level }) => {
                if (levelFilter !== 'ALL' && level !== levelFilter) return false;
                if (searchQuery && !text.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                return true;
            });
    }, [logText, levelFilter, searchQuery]);

    const loadLoggers = async () => {
        setLoggerLoading(true);
        try {
            const data = await actuatorApi.getLoggers();
            setLoggers(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('logs.fetchLoggersFailed'));
        } finally {
            setLoggerLoading(false);
        }
    };

    const handleSetLevel = async (loggerName: string, level: string) => {
        try {
            await actuatorApi.setLoggerLevel(loggerName, level);
            await loadLoggers();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('logs.setLevelFailed'));
        }
    };

    const filteredLoggers = React.useMemo(() => {
        if (!loggerFilter.trim()) return Object.entries(loggers).slice(0, 50);
        return Object.entries(loggers)
            .filter(([name]) => name.toLowerCase().includes(loggerFilter.toLowerCase()))
            .slice(0, 50);
    }, [loggers, loggerFilter]);

    const errorCount = React.useMemo(() => {
        if (!logText) return 0;
        return (logText.match(/\bERROR\b/g) || []).length;
    }, [logText]);

    const warnCount = React.useMemo(() => {
        if (!logText) return 0;
        return (logText.match(/\bWARN\b/g) || []).length;
    }, [logText]);

    return (
        <div className="flex-1 flex flex-col min-w-0 p-4 gap-3">
            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-white">{t('logs.title')}</h2>
                    {errorCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                            {errorCount} ERROR
                        </span>
                    )}
                    {warnCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
                            {warnCount} WARN
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => { setShowLoggerPanel(!showLoggerPanel); if (!showLoggerPanel) loadLoggers(); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showLoggerPanel ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/10'}`}
                    >
                        {t('logs.logLevelManager')}
                    </button>
                </div>
            </div>

            {/* 工具栏 */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-[400px]">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('logs.searchPlaceholder')}
                        className="w-full pl-9 pr-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
                    />
                </div>

                <select
                    value={levelFilter}
                    onChange={(e) => setLevelFilter(e.target.value as LogLevel | 'ALL')}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500/50"
                >
                    {LEVEL_OPTIONS.map(level => (
                        <option key={level} value={level} className="bg-slate-800">{level === 'ALL' ? t('logs.allLevels') : level}</option>
                    ))}
                </select>

                <select
                    value={sizeKB}
                    onChange={(e) => setSizeKB(Number(e.target.value))}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500/50"
                >
                    {SIZE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value} className="bg-slate-800">{opt.label}</option>
                    ))}
                </select>

                <div className="w-px h-6 bg-white/10"></div>

                <button
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${autoRefresh ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'}`}
                >
                    <div className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`}></div>
                    {t('logs.autoRefresh')}
                </button>

                <button
                    onClick={() => setAutoScroll(!autoScroll)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${autoScroll ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'}`}
                >
                    {t('logs.followBottom')}
                </button>

                <button
                    onClick={() => { setLoading(true); fetchLogs().finally(() => setLoading(false)); }}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                >
                    {loading ? t('common:button.loading') : t('common:button.refresh')}
                </button>
            </div>

            {error && (
                <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                    {error}
                </div>
            )}

            {/* Logger 管理面板 */}
            {showLoggerPanel && (
                <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 max-h-[300px] flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <input
                            type="text"
                            value={loggerFilter}
                            onChange={(e) => setLoggerFilter(e.target.value)}
                            placeholder={t('logs.loggerFilterPlaceholder')}
                            className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
                        />
                        <button
                            onClick={loadLoggers}
                            className="px-3 py-1.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-lg text-xs font-medium hover:bg-indigo-500/30 transition-colors"
                        >
                            {loggerLoading ? t('common:button.loading') : t('common:button.refresh')}
                        </button>
                    </div>
                    <div className="overflow-y-auto flex-1 space-y-1">
                        {filteredLoggers.map(([name, info]) => (
                            <div key={name} className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-white/5 group">
                                <span className="flex-1 text-xs text-slate-300 font-mono truncate" title={name}>{name}</span>
                                <span className="text-[10px] text-slate-500 w-14 text-right">{info.effectiveLevel}</span>
                                <select
                                    value={info.configuredLevel || ''}
                                    onChange={(e) => handleSetLevel(name, e.target.value)}
                                    className="px-2 py-0.5 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <option value="" className="bg-slate-800">{t('logs.defaultLevel')}</option>
                                    {(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'OFF'] as const).map(l => (
                                        <option key={l} value={l} className="bg-slate-800">{l}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                        {filteredLoggers.length === 0 && (
                            <div className="text-center text-slate-500 text-xs py-4">
                                {loggerLoading ? t('common:button.loading') : t('logs.noMatchingLoggers')}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 日志内容区域 */}
            <div
                ref={logContainerRef}
                className="flex-1 bg-slate-950/80 border border-white/10 rounded-xl overflow-auto font-mono text-xs leading-5 p-4 min-h-0"
            >
                {loading && !logText ? (
                    <div className="flex items-center justify-center h-full text-slate-500">
                        <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        {t('logs.loadingLogs')}
                    </div>
                ) : processedLines.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-500">
                        {logText ? t('logs.noMatchingLines') : t('logs.noLogs')}
                    </div>
                ) : (
                    processedLines.map((line, index) => {
                        const colorClass = line.level ? LOG_LEVEL_COLORS[line.level] : 'text-slate-400';
                        if (searchQuery && line.text.toLowerCase().includes(searchQuery.toLowerCase())) {
                            const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                            const parts = line.text.split(regex);
                            return (
                                <div key={index} className={`${colorClass} hover:bg-white/5 px-1 whitespace-pre`}>
                                    {parts.map((part, i) =>
                                        regex.test(part)
                                            ? <mark key={i} className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{part}</mark>
                                            : part
                                    )}
                                </div>
                            );
                        }
                        return (
                            <div key={index} className={`${colorClass} hover:bg-white/5 px-1 whitespace-pre`}>
                                {line.text}
                            </div>
                        );
                    })
                )}
            </div>

            {/* 底部状态栏 */}
            <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                <span>
                    {t('logs.lineCount', { count: processedLines.length })}
                    {levelFilter !== 'ALL' ? ` ${t('logs.filterInfo', { level: levelFilter })}` : ''}
                    {searchQuery ? ` ${t('logs.searchInfo', { query: searchQuery })}` : ''}
                </span>
                <span>{autoRefresh ? t('logs.autoRefreshStatus') : t('logs.autoRefreshPaused')}</span>
            </div>
        </div>
    );
};

export default ServerLogsTab;
