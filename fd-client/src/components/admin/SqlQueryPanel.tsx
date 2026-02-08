import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { adminApi } from '../../services/serverApi';
import type { SqlQueryResult, TableInfo } from '../../types/server';

const QUICK_QUERIES = [
    { label: 'TICKETS', sql: 'SELECT * FROM TICKET ORDER BY ID DESC LIMIT 50' },
    { label: 'USERS', sql: 'SELECT ID, USERNAME, ROLE, STATUS, CREATED_AT FROM SYS_USER ORDER BY ID' },
    { label: 'TRANSLATIONS', sql: 'SELECT * FROM TICKET_TRANSLATION ORDER BY ID DESC LIMIT 50' },
    { label: 'REPLIES', sql: 'SELECT * FROM TICKET_REPLY ORDER BY ID DESC LIMIT 50' },
    { label: 'SYNC LOGS', sql: 'SELECT * FROM SYNC_LOG ORDER BY ID DESC LIMIT 20' },
];

const HISTORY_KEY = 'fd_sql_history';
const MAX_HISTORY = 20;

const SqlQueryPanel: React.FC = () => {
    const [sql, setSql] = useState('');
    const [result, setResult] = useState<SqlQueryResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<string[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [showTables, setShowTables] = useState(false);
    const [tablesLoading, setTablesLoading] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ col: number; dir: 'asc' | 'desc' } | null>(null);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const historyRef = useRef<HTMLDivElement>(null);

    // 恢复历史
    useEffect(() => {
        try {
            const saved = localStorage.getItem(HISTORY_KEY);
            if (saved) setHistory(JSON.parse(saved));
        } catch { /* ignore */ }
    }, []);

    // 点击外部关闭历史下拉
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
                setShowHistory(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const loadTables = useCallback(async () => {
        if (tables.length > 0) {
            setShowTables(!showTables);
            return;
        }
        setTablesLoading(true);
        try {
            const data = await adminApi.getDatabaseTables();
            setTables(data);
            setShowTables(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : '获取表结构失败');
        } finally {
            setTablesLoading(false);
        }
    }, [tables.length, showTables]);

    const executeQuery = useCallback(async () => {
        const trimmed = sql.trim();
        if (!trimmed) return;

        // 前端危险 SQL 确认
        const upperSql = trimmed.toUpperCase();
        const dangerous = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'UPDATE'].find(k => upperSql.startsWith(k));
        if (dangerous) {
            const confirmed = window.confirm(`当前 SQL 包含 ${dangerous} 操作，确认执行？`);
            if (!confirmed) return;
        }

        setLoading(true);
        setError(null);
        setSortConfig(null);

        try {
            const res = await adminApi.executeSql(trimmed);
            setResult(res);

            // 保存历史
            const newHistory = [trimmed, ...history.filter(h => h !== trimmed)].slice(0, MAX_HISTORY);
            setHistory(newHistory);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
        } catch (err) {
            setError(err instanceof Error ? err.message : '执行失败');
            setResult(null);
        } finally {
            setLoading(false);
        }
    }, [sql, history]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            executeQuery();
        }
    };

    // 排序后的行
    const sortedRows = useMemo(() => {
        if (!result?.rows || !sortConfig) return result?.rows || [];
        const { col, dir } = sortConfig;
        return [...result.rows].sort((a, b) => {
            const va = a[col];
            const vb = b[col];
            if (va === null && vb === null) return 0;
            if (va === null) return 1;
            if (vb === null) return -1;
            if (typeof va === 'number' && typeof vb === 'number') {
                return dir === 'asc' ? va - vb : vb - va;
            }
            const sa = String(va);
            const sb = String(vb);
            return dir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
        });
    }, [result?.rows, sortConfig]);

    const handleSort = (colIndex: number) => {
        setSortConfig(prev => {
            if (prev?.col === colIndex) {
                return prev.dir === 'asc' ? { col: colIndex, dir: 'desc' } : null;
            }
            return { col: colIndex, dir: 'asc' };
        });
    };

    return (
        <div className="flex-1 flex flex-col gap-3 min-h-0">
            {/* SQL 输入区 */}
            <div className="flex flex-col gap-2">
                <textarea
                    ref={textareaRef}
                    value={sql}
                    onChange={e => setSql(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入 SQL 查询... (Ctrl+Enter 执行)"
                    spellCheck={false}
                    className="w-full h-32 px-4 py-3 bg-slate-950/80 border border-white/10 rounded-xl font-mono text-sm text-green-400 placeholder-slate-600 resize-y focus:outline-none focus:border-indigo-500/50 leading-relaxed"
                />

                {/* 工具栏 */}
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={executeQuery}
                        disabled={loading || !sql.trim()}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-lg text-xs font-medium hover:bg-indigo-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <>
                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                执行中...
                            </>
                        ) : (
                            <>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                </svg>
                                执行 (⌘↵)
                            </>
                        )}
                    </button>

                    <button
                        onClick={() => { setSql(''); setResult(null); setError(null); setSortConfig(null); }}
                        className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                    >
                        清空
                    </button>

                    {/* 历史 */}
                    <div className="relative" ref={historyRef}>
                        <button
                            onClick={() => setShowHistory(!showHistory)}
                            disabled={history.length === 0}
                            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-slate-400 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40"
                        >
                            历史 ({history.length})
                        </button>
                        {showHistory && history.length > 0 && (
                            <div className="absolute top-full left-0 mt-1 w-96 max-h-64 overflow-y-auto bg-slate-800 border border-white/10 rounded-xl shadow-xl z-50">
                                {history.map((h, i) => (
                                    <button
                                        key={i}
                                        onClick={() => { setSql(h); setShowHistory(false); }}
                                        className="w-full px-3 py-2 text-left text-xs font-mono text-slate-300 hover:bg-white/5 truncate border-b border-white/5 last:border-0"
                                        title={h}
                                    >
                                        {h}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 表结构 */}
                    <button
                        onClick={loadTables}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showTables ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/10'}`}
                    >
                        {tablesLoading ? '加载中...' : '表结构'}
                    </button>

                    <div className="w-px h-5 bg-white/10" />

                    {/* 快捷查询 */}
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">快捷:</span>
                    {QUICK_QUERIES.map(q => (
                        <button
                            key={q.label}
                            onClick={() => setSql(q.sql)}
                            className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[10px] text-slate-500 hover:bg-white/10 hover:text-slate-300 transition-colors"
                        >
                            {q.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 表结构面板 */}
            {showTables && tables.length > 0 && (
                <div className="bg-slate-800/50 border border-white/10 rounded-xl p-3 max-h-48 overflow-y-auto">
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                        {tables.map(t => (
                            <div key={t.tableName} className="text-xs">
                                <button
                                    onClick={() => setSql(`SELECT * FROM ${t.tableName} LIMIT 50`)}
                                    className="font-medium text-indigo-400 hover:text-indigo-300 mb-1 cursor-pointer"
                                >
                                    {t.tableName}
                                </button>
                                <div className="space-y-0.5">
                                    {t.columns.map(c => (
                                        <div key={c.name} className="flex items-center gap-1.5 text-slate-500">
                                            {c.primaryKey && <span className="text-yellow-500 text-[9px]">PK</span>}
                                            <span className="text-slate-400">{c.name}</span>
                                            <span className="text-slate-600">{c.type}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 错误提示 */}
            {error && (
                <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                    {error}
                </div>
            )}

            {/* SQL 执行错误（来自后端） */}
            {result && !result.success && result.error && (
                <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 font-mono">
                    {result.error}
                </div>
            )}

            {/* DML 结果 */}
            {result && result.success && result.updateCount !== undefined && result.updateCount !== null && (
                <div className={`px-4 py-2 rounded-lg text-sm ${result.destructive ? 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400' : 'bg-green-500/10 border border-green-500/20 text-green-400'}`}>
                    {result.destructive && '⚠ '}
                    影响 {result.updateCount} 行，耗时 {result.executionTimeMs}ms
                </div>
            )}

            {/* SELECT 结果 */}
            {result && result.success && result.columns && (
                <>
                    {/* 状态栏 */}
                    <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                        <span>查询到 {result.rowCount} 行，耗时 {result.executionTimeMs}ms</span>
                        {sortConfig && (
                            <span>
                                排序: {result.columns[sortConfig.col]?.name} ({sortConfig.dir === 'asc' ? '升序' : '降序'})
                            </span>
                        )}
                    </div>

                    {/* 结果表格 */}
                    <div className="flex-1 overflow-auto border border-white/10 rounded-xl min-h-0">
                        {sortedRows.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-slate-500 text-sm py-8">
                                查询结果为空
                            </div>
                        ) : (
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 z-10">
                                    <tr className="bg-slate-800/90 backdrop-blur-sm">
                                        <th className="px-3 py-2 text-left text-slate-500 font-medium border-b border-white/10 w-10">#</th>
                                        {result.columns.map((col, i) => (
                                            <th
                                                key={i}
                                                onClick={() => handleSort(i)}
                                                className="px-3 py-2 text-left font-medium border-b border-white/10 cursor-pointer hover:bg-white/5 transition-colors select-none"
                                            >
                                                <div className="flex items-center gap-1">
                                                    <span className="text-slate-300">{col.name}</span>
                                                    <span className="text-slate-600 text-[10px]">{col.type}</span>
                                                    {sortConfig?.col === i && (
                                                        <span className="text-indigo-400">
                                                            {sortConfig.dir === 'asc' ? '↑' : '↓'}
                                                        </span>
                                                    )}
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedRows.map((row, ri) => (
                                        <tr key={ri} className="hover:bg-white/5 transition-colors">
                                            <td className="px-3 py-1.5 text-slate-600 border-b border-white/5 font-mono">
                                                {ri + 1}
                                            </td>
                                            {row.map((cell, ci) => (
                                                <td
                                                    key={ci}
                                                    className="px-3 py-1.5 border-b border-white/5 font-mono max-w-xs truncate"
                                                    title={cell === null ? 'NULL' : String(cell)}
                                                >
                                                    {cell === null ? (
                                                        <span className="text-slate-600 italic">NULL</span>
                                                    ) : typeof cell === 'boolean' ? (
                                                        <span className={cell ? 'text-green-400' : 'text-red-400'}>
                                                            {String(cell)}
                                                        </span>
                                                    ) : typeof cell === 'number' ? (
                                                        <span className="text-blue-400">{cell}</span>
                                                    ) : (
                                                        <span className="text-slate-300">{String(cell)}</span>
                                                    )}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </>
            )}

            {/* 无结果时的空状态 */}
            {!result && !error && !loading && (
                <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
                    输入 SQL 并按 Ctrl+Enter 执行查询
                </div>
            )}
        </div>
    );
};

export default SqlQueryPanel;
