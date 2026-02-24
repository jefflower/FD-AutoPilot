/**
 * AI Agent 能力绑定与日志页面 — Agent 管理已迁移到工作流中心
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { agentApi } from '../../../shared/services/serverApi';
import type { AgentDefinition, AgentBindings, AgentExecutionLog, AgentStats } from '../../../shared/types/server';
import { useAgentContext } from '../../../shared/agents';

type SubTab = 'bindings' | 'logs' | 'stats';

const AgentManageTab: React.FC = () => {
    const { t } = useTranslation(['common']);
    const { reload: reloadAgentContext } = useAgentContext();

    const [subTab, setSubTab] = useState<SubTab>('bindings');
    const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
    const [bindings, setBindings] = useState<AgentBindings>({});
    const [logs, setLogs] = useState<AgentExecutionLog[]>([]);
    const [stats, setStats] = useState<AgentStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // 日志分页
    const [logPage, setLogPage] = useState(0);
    const [logTotal, setLogTotal] = useState(0);
    const [logFilter, setLogFilter] = useState('');

    const showSuccess = (msg: string) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(null), 3000);
    };

    const loadDefinitions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const defs = await agentApi.getAllDefinitions();
            setDefinitions(defs);
        } catch (err: any) {
            setError(err.message || 'Failed to load definitions');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadBindings = useCallback(async () => {
        try {
            const b = await agentApi.getBindings();
            setBindings(b);
        } catch (err: any) {
            console.warn('Failed to load bindings:', err);
        }
    }, []);

    const loadLogs = useCallback(async () => {
        setLoading(true);
        try {
            const result = await agentApi.getExecutions({
                agentCode: logFilter || undefined,
                page: logPage,
                size: 20,
            });
            setLogs(result.content);
            setLogTotal(result.totalPages);
        } catch (err: any) {
            console.warn('Failed to load logs:', err);
        } finally {
            setLoading(false);
        }
    }, [logFilter, logPage]);

    const loadStats = useCallback(async () => {
        setLoading(true);
        try {
            const s = await agentApi.getStats();
            setStats(s);
        } catch (err: any) {
            console.warn('Failed to load stats:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (subTab === 'bindings') { loadDefinitions(); loadBindings(); }
        else if (subTab === 'logs') loadLogs();
        else if (subTab === 'stats') loadStats();
    }, [subTab, loadDefinitions, loadBindings, loadLogs, loadStats]);

    const handleBindingChange = async (capability: string, agentCode: string) => {
        try {
            if (agentCode) {
                await agentApi.setBinding(capability, agentCode);
            } else {
                await agentApi.removeBinding(capability);
            }
            await loadBindings();
            reloadAgentContext();
            showSuccess(t('message.saveSuccess'));
        } catch (err: any) {
            setError(err.message);
        }
    };

    // 获取所有能力标签
    const capabilities = [...new Set(definitions.map(d => d.capability))];

    const subTabs: { key: SubTab; label: string }[] = [
        { key: 'bindings', label: '能力绑定' },
        { key: 'logs', label: '执行日志' },
        { key: 'stats', label: '统计' },
    ];

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* 顶部消息 */}
            {error && (
                <div className="mx-4 mt-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-2">&times;</button>
                </div>
            )}
            {successMsg && (
                <div className="mx-4 mt-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-sm">
                    {successMsg}
                </div>
            )}

            {/* 子标签页 */}
            <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-slate-700/50">
                {subTabs.map(st => (
                    <button
                        key={st.key}
                        onClick={() => setSubTab(st.key)}
                        className={`px-3 py-1.5 rounded text-sm transition-colors ${
                            subTab === st.key
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50'
                        }`}
                    >
                        {st.label}
                    </button>
                ))}
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-auto p-4">
                {subTab === 'bindings' && (
                    <BindingsPanel
                        capabilities={capabilities}
                        definitions={definitions}
                        bindings={bindings}
                        onBindingChange={handleBindingChange}
                    />
                )}

                {subTab === 'logs' && (
                    <LogsPanel
                        logs={logs}
                        definitions={definitions}
                        loading={loading}
                        logFilter={logFilter}
                        setLogFilter={setLogFilter}
                        logPage={logPage}
                        setLogPage={setLogPage}
                        logTotal={logTotal}
                    />
                )}

                {subTab === 'stats' && (
                    <StatsPanel stats={stats} loading={loading} />
                )}
            </div>
        </div>
    );
};

/* ============ 子面板组件 ============ */

const BindingsPanel: React.FC<{
    capabilities: string[];
    definitions: AgentDefinition[];
    bindings: AgentBindings;
    onBindingChange: (capability: string, agentCode: string) => void;
}> = ({ capabilities, definitions, bindings, onBindingChange }) => (
    <div>
        <h3 className="text-slate-200 font-medium mb-2">能力绑定配置</h3>
        <p className="text-xs text-slate-500 mb-1">
            为每种 AI 能力指定默认使用的 Agent。系统会优先使用绑定的 Agent，未绑定时按能力标签自动匹配。
        </p>
        <p className="text-xs text-slate-600 mb-4">
            完整的 Agent 管理请前往 工作流 → Agent 管理
        </p>

        <div className="space-y-3">
            {capabilities.map(cap => {
                const available = definitions.filter(d => d.capability === cap && d.enabled);
                const currentBinding = bindings[cap] || '';

                return (
                    <div key={cap} className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <span className="text-slate-200 font-medium">{cap}</span>
                                <span className="text-xs text-slate-500 ml-2">
                                    ({available.length} 个可用 Agent)
                                </span>
                            </div>
                            <select
                                value={currentBinding}
                                onChange={(e) => onBindingChange(cap, e.target.value)}
                                className="bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                            >
                                <option value="">自动选择</option>
                                {available.map(d => (
                                    <option key={d.code} value={d.code}>{d.name} ({d.code})</option>
                                ))}
                            </select>
                        </div>
                    </div>
                );
            })}

            {capabilities.length === 0 && (
                <div className="text-center text-slate-500 py-8">暂无能力标签</div>
            )}
        </div>
    </div>
);

const LogsPanel: React.FC<{
    logs: AgentExecutionLog[];
    definitions: AgentDefinition[];
    loading: boolean;
    logFilter: string;
    setLogFilter: (v: string) => void;
    logPage: number;
    setLogPage: (v: number) => void;
    logTotal: number;
}> = ({ logs, definitions, loading, logFilter, setLogFilter, logPage, setLogPage, logTotal }) => {
    const STATUS_COLORS: Record<string, string> = {
        SUCCESS: 'text-green-400',
        FAILED: 'text-red-400',
        RUNNING: 'text-blue-400',
        TIMEOUT: 'text-yellow-400',
        CANCELLED: 'text-slate-400',
    };

    return (
        <div>
            <div className="flex items-center gap-3 mb-4">
                <h3 className="text-slate-200 font-medium">执行日志</h3>
                <select
                    value={logFilter}
                    onChange={(e) => { setLogFilter(e.target.value); setLogPage(0); }}
                    className="bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1"
                >
                    <option value="">全部 Agent</option>
                    {definitions.map(d => (
                        <option key={d.code} value={d.code}>{d.name}</option>
                    ))}
                </select>
            </div>

            {loading ? <LoadingSpinner /> : (
                <>
                    <div className="space-y-1">
                        {logs.map(log => (
                            <div key={log.id} className="p-2 bg-slate-800/30 border border-slate-700/30 rounded text-sm flex items-center gap-3">
                                <span className={`font-mono text-xs w-16 ${STATUS_COLORS[log.status] || 'text-slate-400'}`}>
                                    {log.status}
                                </span>
                                <code className="text-slate-400 text-xs w-32 truncate">{log.agentCode}</code>
                                <span className="text-slate-500 text-xs w-16 text-right">{log.durationMs ? `${log.durationMs}ms` : '-'}</span>
                                <span className="text-slate-500 text-xs w-12 text-right">{log.executedOn}</span>
                                <span className="text-slate-600 text-xs flex-1 truncate">{log.errorMessage || log.outputSnapshot || '-'}</span>
                                <span className="text-slate-600 text-xs w-36">{log.createdAt}</span>
                            </div>
                        ))}
                    </div>

                    {logs.length === 0 && (
                        <div className="text-center text-slate-500 py-8">暂无执行日志</div>
                    )}

                    {logTotal > 1 && (
                        <div className="flex items-center justify-center gap-3 mt-4">
                            <button
                                disabled={logPage === 0}
                                onClick={() => setLogPage(logPage - 1)}
                                className="px-2 py-1 text-xs text-slate-400 hover:text-slate-300 disabled:opacity-30"
                            >
                                上一页
                            </button>
                            <span className="text-xs text-slate-500">{logPage + 1} / {logTotal}</span>
                            <button
                                disabled={logPage >= logTotal - 1}
                                onClick={() => setLogPage(logPage + 1)}
                                className="px-2 py-1 text-xs text-slate-400 hover:text-slate-300 disabled:opacity-30"
                            >
                                下一页
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

const StatsPanel: React.FC<{
    stats: AgentStats[];
    loading: boolean;
}> = ({ stats, loading }) => {
    if (loading) return <LoadingSpinner />;

    return (
        <div>
            <h3 className="text-slate-200 font-medium mb-4">Agent 统计仪表盘</h3>

            {stats.length === 0 ? (
                <div className="text-center text-slate-500 py-8">暂无统计数据</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {stats.map(s => (
                        <div key={s.agentCode} className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-slate-200 font-medium">{s.agentName}</span>
                                <code className="text-xs text-slate-500">{s.agentCode}</code>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                    <div className="text-slate-500 text-xs">总调用</div>
                                    <div className="text-slate-200">{s.totalExecutions}</div>
                                </div>
                                <div>
                                    <div className="text-slate-500 text-xs">成功率</div>
                                    <div className={s.successRate >= 0.9 ? 'text-green-400' : s.successRate >= 0.7 ? 'text-yellow-400' : 'text-red-400'}>
                                        {(s.successRate * 100).toFixed(1)}%
                                    </div>
                                </div>
                                <div>
                                    <div className="text-slate-500 text-xs">成功/失败</div>
                                    <div className="text-slate-200">
                                        <span className="text-green-400">{s.successCount}</span>
                                        {' / '}
                                        <span className="text-red-400">{s.failedCount}</span>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-slate-500 text-xs">平均耗时</div>
                                    <div className="text-slate-200">{s.avgDurationMs ? `${Math.round(s.avgDurationMs)}ms` : '-'}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const LoadingSpinner: React.FC = () => (
    <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-600 border-t-blue-400" />
    </div>
);

export default AgentManageTab;
