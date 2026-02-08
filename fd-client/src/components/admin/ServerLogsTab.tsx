/**
 * 服务端日志查看组件 (管理员专属)
 * 通过 Actuator /logfile 端点获取日志内容
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    // 匹配标准 logback 格式中的级别字段
    if (/\bERROR\b/.test(line)) return 'ERROR';
    if (/\bWARN\b/.test(line)) return 'WARN';
    if (/\bINFO\b/.test(line)) return 'INFO';
    if (/\bDEBUG\b/.test(line)) return 'DEBUG';
    if (/\bTRACE\b/.test(line)) return 'TRACE';
    return null;
}

const ServerLogsTab: React.FC = () => {
    const [logText, setLogText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 控制项
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [sizeKB, setSizeKB] = useState(200);
    const [levelFilter, setLevelFilter] = useState<LogLevel | 'ALL'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [autoScroll, setAutoScroll] = useState(true);

    // 动态调级
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
            setError(err instanceof Error ? err.message : '获取日志失败');
        }
    }, [sizeKB]);

    // 初次加载
    useEffect(() => {
        setLoading(true);
        fetchLogs().finally(() => setLoading(false));
    }, [fetchLogs]);

    // 自动刷新
    useEffect(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (autoRefresh) {
            intervalRef.current = setInterval(fetchLogs, 3000);
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [autoRefresh, fetchLogs]);

    // 自动滚动到底部
    useEffect(() => {
        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logText, autoScroll]);

    // 处理日志行
    const processedLines = React.useMemo(() => {
        if (!logText) return [];
        const lines = logText.split('\n');
        return lines
            .map(line => ({ text: line, level: detectLogLevel(line) }))
            .filter(({ text, level }) => {
                // 级别过滤
                if (levelFilter !== 'ALL' && level !== levelFilter) return false;
                // 搜索过滤
                if (searchQuery && !text.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                return true;
            });
    }, [logText, levelFilter, searchQuery]);

    // 加载 loggers
    const loadLoggers = async () => {
        setLoggerLoading(true);
        try {
            const data = await actuatorApi.getLoggers();
            setLoggers(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : '获取 loggers 失败');
        } finally {
            setLoggerLoading(false);
        }
    };

    const handleSetLevel = async (loggerName: string, level: string) => {
        try {
            await actuatorApi.setLoggerLevel(loggerName, level);
            await loadLoggers();
        } catch (err) {
            setError(err instanceof Error ? err.message : '设置级别失败');
        }
    };

    // 过滤 loggers
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
                    <h2 className="text-lg font-semibold text-white">服务端日志</h2>
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
                        日志级别管理
                    </button>
                </div>
            </div>

            {/* 工具栏 */}
            <div className="flex items-center gap-3 flex-wrap">
                {/* 搜索 */}
                <div className="relative flex-1 min-w-[200px] max-w-[400px]">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索日志..."
                        className="w-full pl-9 pr-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
                    />
                </div>

                {/* 级别过滤 */}
                <select
                    value={levelFilter}
                    onChange={(e) => setLevelFilter(e.target.value as LogLevel | 'ALL')}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500/50"
                >
                    {LEVEL_OPTIONS.map(level => (
                        <option key={level} value={level} className="bg-slate-800">{level === 'ALL' ? '全部级别' : level}</option>
                    ))}
                </select>

                {/* 加载大小 */}
                <select
                    value={sizeKB}
                    onChange={(e) => setSizeKB(Number(e.target.value))}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500/50"
                >
                    {SIZE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value} className="bg-slate-800">{opt.label}</option>
                    ))}
                </select>

                {/* 分隔 */}
                <div className="w-px h-6 bg-white/10"></div>

                {/* 自动刷新 */}
                <button
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${autoRefresh ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'}`}
                >
                    <div className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`}></div>
                    自动刷新
                </button>

                {/* 自动滚动 */}
                <button
                    onClick={() => setAutoScroll(!autoScroll)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${autoScroll ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'}`}
                >
                    跟踪底部
                </button>

                {/* 手动刷新 */}
                <button
                    onClick={() => { setLoading(true); fetchLogs().finally(() => setLoading(false)); }}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                >
                    {loading ? '加载中...' : '刷新'}
                </button>
            </div>

            {/* 错误提示 */}
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
                            placeholder="过滤 logger 名称..."
                            className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
                        />
                        <button
                            onClick={loadLoggers}
                            className="px-3 py-1.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-lg text-xs font-medium hover:bg-indigo-500/30 transition-colors"
                        >
                            {loggerLoading ? '加载中...' : '刷新'}
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
                                    <option value="" className="bg-slate-800">默认</option>
                                    {(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'OFF'] as const).map(l => (
                                        <option key={l} value={l} className="bg-slate-800">{l}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                        {filteredLoggers.length === 0 && (
                            <div className="text-center text-slate-500 text-xs py-4">
                                {loggerLoading ? '加载中...' : '无匹配的 logger'}
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
                        加载日志中...
                    </div>
                ) : processedLines.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-500">
                        {logText ? '没有匹配的日志行' : '暂无日志'}
                    </div>
                ) : (
                    processedLines.map((line, index) => {
                        const colorClass = line.level ? LOG_LEVEL_COLORS[line.level] : 'text-slate-400';
                        // 搜索关键字高亮
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
                <span>{processedLines.length} 行{levelFilter !== 'ALL' ? ` (过滤: ${levelFilter})` : ''}{searchQuery ? ` (搜索: "${searchQuery}")` : ''}</span>
                <span>{autoRefresh ? '每 3 秒自动刷新' : '自动刷新已暂停'}</span>
            </div>
        </div>
    );
};

export default ServerLogsTab;
