/**
 * AI Agent 管理页面
 *
 * 功能：Agent 定义 CRUD、启用/禁用、能力绑定配置、执行日志、统计仪表盘
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { agentApi } from '../../../shared/services/serverApi';
import type { AgentDefinition, AgentBindings, AgentExecutionLog, AgentStats, AgentProxyTestResult } from '../../../shared/types/server';
import { useAgentContext } from '../../../shared/agents';

type SubTab = 'definitions' | 'bindings' | 'logs' | 'stats';

const PROVIDER_TYPE_LABELS: Record<string, { label: string; color: string }> = {
    LOCAL_CLI: { label: 'CLI', color: 'bg-green-500/20 text-green-400' },
    HTTP_API: { label: 'HTTP API', color: 'bg-blue-500/20 text-blue-400' },
    SHADOW_WINDOW: { label: 'Shadow', color: 'bg-purple-500/20 text-purple-400' },
    LOCAL_FUNCTION: { label: 'Function', color: 'bg-amber-500/20 text-amber-400' },
};

const ENV_LABELS: Record<string, string> = {
    CLIENT_ONLY: 'Client',
    SERVER_ONLY: 'Server',
    BOTH: 'Both',
};

const AgentManageTab: React.FC = () => {
    const { t } = useTranslation(['common']);
    const { reload: reloadAgentContext } = useAgentContext();

    const [subTab, setSubTab] = useState<SubTab>('definitions');
    const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
    const [bindings, setBindings] = useState<AgentBindings>({});
    const [logs, setLogs] = useState<AgentExecutionLog[]>([]);
    const [stats, setStats] = useState<AgentStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [operating, setOperating] = useState<number | null>(null);

    // 日志分页
    const [logPage, setLogPage] = useState(0);
    const [logTotal, setLogTotal] = useState(0);
    const [logFilter, setLogFilter] = useState('');

    // 编辑弹窗
    const [editingDef, setEditingDef] = useState<Partial<AgentDefinition> | null>(null);
    const [saving, setSaving] = useState(false);

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
        if (subTab === 'definitions') { loadDefinitions(); loadBindings(); }
        else if (subTab === 'bindings') { loadDefinitions(); loadBindings(); }
        else if (subTab === 'logs') loadLogs();
        else if (subTab === 'stats') loadStats();
    }, [subTab, loadDefinitions, loadBindings, loadLogs, loadStats]);

    const handleToggle = async (id: number) => {
        setOperating(id);
        try {
            await agentApi.toggleDefinition(id);
            await loadDefinitions();
            reloadAgentContext();
            showSuccess(t('message.operationSuccess'));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setOperating(null);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm(t('message.confirmDelete'))) return;
        setOperating(id);
        try {
            await agentApi.deleteDefinition(id);
            await loadDefinitions();
            reloadAgentContext();
            showSuccess(t('message.operationSuccess'));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setOperating(null);
        }
    };

    const handleSaveDef = async () => {
        if (!editingDef) return;
        setSaving(true);
        try {
            // providerConfig 在前端是对象，后端期望 JSON 字符串
            const payload = {
                ...editingDef,
                providerConfig: typeof editingDef.providerConfig === 'object'
                    ? JSON.stringify(editingDef.providerConfig)
                    : editingDef.providerConfig,
            };
            if (editingDef.id) {
                await agentApi.updateDefinition(editingDef.id, payload);
            } else {
                await agentApi.createDefinition(payload);
            }
            setEditingDef(null);
            await loadDefinitions();
            reloadAgentContext();
            showSuccess(t('message.saveSuccess'));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

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
        { key: 'definitions', label: 'Agent 定义' },
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
                {subTab === 'definitions' && (
                    <DefinitionsPanel
                        definitions={definitions}
                        loading={loading}
                        operating={operating}
                        onToggle={handleToggle}
                        onDelete={handleDelete}
                        onEdit={setEditingDef}
                        onCreate={() => setEditingDef({
                            code: '',
                            name: '',
                            description: '',
                            providerType: 'HTTP_API',
                            executionEnv: 'BOTH',
                            capability: '',
                            providerConfig: {},
                            enabled: true,
                        })}
                    />
                )}

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

            {/* 编辑弹窗 */}
            {editingDef && (
                <EditModal
                    def={editingDef}
                    onChange={setEditingDef}
                    onSave={handleSaveDef}
                    onCancel={() => setEditingDef(null)}
                    saving={saving}
                />
            )}
        </div>
    );
};

/* ============ 子面板组件 ============ */

const DefinitionsPanel: React.FC<{
    definitions: AgentDefinition[];
    loading: boolean;
    operating: number | null;
    onToggle: (id: number) => void;
    onDelete: (id: number) => void;
    onEdit: (def: Partial<AgentDefinition>) => void;
    onCreate: () => void;
}> = ({ definitions, loading, operating, onToggle, onDelete, onEdit, onCreate }) => {
    if (loading) return <LoadingSpinner />;

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-slate-200 font-medium">Agent 定义列表</h3>
                <button
                    onClick={onCreate}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                >
                    + 新建 Agent
                </button>
            </div>

            <div className="space-y-2">
                {definitions.map(def => (
                    <div key={def.id} className={`p-3 rounded-lg border transition-colors ${
                        def.enabled
                            ? 'bg-slate-800/50 border-slate-700/50'
                            : 'bg-slate-900/50 border-slate-800/50 opacity-60'
                    }`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-slate-200 font-medium">{def.name}</span>
                                        <code className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{def.code}</code>
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${PROVIDER_TYPE_LABELS[def.providerType]?.color || 'bg-slate-700 text-slate-400'}`}>
                                            {PROVIDER_TYPE_LABELS[def.providerType]?.label || def.providerType}
                                        </span>
                                        <span className="text-xs text-slate-500">{ENV_LABELS[def.executionEnv] || def.executionEnv}</span>
                                        {def.builtIn && <span className="text-xs text-slate-600">built-in</span>}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-0.5">
                                        {def.description} · capability: <code>{def.capability}</code>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => onToggle(def.id)}
                                    disabled={operating === def.id}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${
                                        def.enabled
                                            ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                    }`}
                                >
                                    {def.enabled ? '已启用' : '已禁用'}
                                </button>
                                <button
                                    onClick={() => onEdit({ ...def })}
                                    className="px-2 py-1 text-xs text-slate-400 hover:text-slate-300 bg-slate-700/50 hover:bg-slate-700 rounded transition-colors"
                                >
                                    编辑
                                </button>
                                {!def.builtIn && (
                                    <button
                                        onClick={() => onDelete(def.id)}
                                        disabled={operating === def.id}
                                        className="px-2 py-1 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded transition-colors"
                                    >
                                        删除
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}

                {definitions.length === 0 && (
                    <div className="text-center text-slate-500 py-8">暂无 Agent 定义</div>
                )}
            </div>
        </div>
    );
};

const BindingsPanel: React.FC<{
    capabilities: string[];
    definitions: AgentDefinition[];
    bindings: AgentBindings;
    onBindingChange: (capability: string, agentCode: string) => void;
}> = ({ capabilities, definitions, bindings, onBindingChange }) => (
    <div>
        <h3 className="text-slate-200 font-medium mb-2">能力绑定配置</h3>
        <p className="text-xs text-slate-500 mb-4">
            为每种 AI 能力指定默认使用的 Agent。系统会优先使用绑定的 Agent，未绑定时按能力标签自动匹配。
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

/* ============ HTTP API 配置面板 ============ */

type ProxyStatus = 'idle' | 'testing' | 'reachable' | 'unreachable';

const HttpApiConfigPanel: React.FC<{
    config: Record<string, any>;
    onChange: (config: Record<string, any>) => void;
}> = ({ config, onChange }) => {
    const [proxyStatus, setProxyStatus] = useState<ProxyStatus>('idle');
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [proxyError, setProxyError] = useState('');

    const baseUrl = config.baseUrl || '';
    const model = config.model || '';
    const apiKey = config.apiKey || '';
    const maxTokens = config.maxTokens ?? 8192;
    const systemPrompt = config.systemPrompt || '';

    const updateField = (field: string, value: any) => {
        onChange({ ...config, [field]: value });
    };

    const handleTestProxy = async () => {
        if (!baseUrl.trim()) return;
        setProxyStatus('testing');
        setProxyError('');
        try {
            const result: AgentProxyTestResult = await agentApi.testProxy(baseUrl, apiKey);
            if (result.reachable) {
                setProxyStatus('reachable');
                setAvailableModels(result.models || []);
            } else {
                setProxyStatus('unreachable');
                setProxyError(result.errorMessage || '连接失败');
            }
        } catch (err: any) {
            setProxyStatus('unreachable');
            setProxyError(err.message || '请求失败');
        }
    };

    return (
        <div className="space-y-3">
            {/* Base URL + 检测按钮 */}
            <div>
                <label className="text-xs text-slate-500 mb-1 block">Base URL</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={baseUrl}
                        onChange={e => updateField('baseUrl', e.target.value)}
                        placeholder="http://localhost:8045/v1"
                        className="flex-1 bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                    />
                    <button
                        onClick={handleTestProxy}
                        disabled={proxyStatus === 'testing' || !baseUrl.trim()}
                        className="px-3 py-1.5 text-xs bg-slate-600 hover:bg-slate-500 text-slate-200 rounded disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                        {proxyStatus === 'testing' ? (
                            <span className="flex items-center gap-1.5">
                                <span className="animate-spin inline-block w-3 h-3 border border-slate-400 border-t-transparent rounded-full" />
                                检测中...
                            </span>
                        ) : '检测连接'}
                    </button>
                </div>
            </div>

            {/* 状态指示器 */}
            {proxyStatus === 'reachable' && (
                <div className="px-3 py-2 bg-green-500/10 border border-green-500/20 rounded text-xs text-green-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-400" />
                    代理已连接（{availableModels.length} 个模型可用）
                </div>
            )}
            {proxyStatus === 'unreachable' && (
                <div className="space-y-2">
                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-red-400" />
                        代理不可达：{proxyError}
                    </div>
                    {/* 安装引导 */}
                    <div className="px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                        <div className="text-amber-400 text-xs font-medium mb-1.5">安装引导</div>
                        <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
                            <li>
                                下载{' '}
                                <a href="https://github.com/lbjlaq/Antigravity-Manager/releases" target="_blank" rel="noopener noreferrer"
                                    className="text-blue-400 hover:text-blue-300 underline">
                                    Antigravity-Manager
                                </a>
                                {' '}安装包
                            </li>
                            <li>安装并登录 Google 账号授权</li>
                            <li>在 API Proxy 标签页启动代理服务</li>
                            <li>默认地址: <code className="text-slate-300 bg-slate-700/50 px-1 rounded">http://localhost:8045/v1</code></li>
                        </ol>
                    </div>
                </div>
            )}

            {/* Model 选择 */}
            <div>
                <label className="text-xs text-slate-500 mb-1 block">Model</label>
                {availableModels.length > 0 ? (
                    <select
                        value={availableModels.includes(model) ? model : ''}
                        onChange={e => updateField('model', e.target.value)}
                        className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                    >
                        {!availableModels.includes(model) && model && (
                            <option value="">{model}（当前，不在列表中）</option>
                        )}
                        {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                ) : (
                    <input
                        type="text"
                        value={model}
                        onChange={e => updateField('model', e.target.value)}
                        placeholder="gemini-2.5-flash"
                        className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                    />
                )}
            </div>

            {/* API Key + Max Tokens */}
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs text-slate-500 mb-1 block">API Key（可选）</label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={e => updateField('apiKey', e.target.value)}
                        placeholder="本地代理通常无需填写"
                        className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                    />
                </div>
                <div>
                    <label className="text-xs text-slate-500 mb-1 block">Max Tokens</label>
                    <input
                        type="number"
                        value={maxTokens}
                        onChange={e => updateField('maxTokens', parseInt(e.target.value) || 4096)}
                        className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                    />
                </div>
            </div>

            {/* System Prompt */}
            <div>
                <label className="text-xs text-slate-500 mb-1 block">System Prompt</label>
                <textarea
                    value={systemPrompt}
                    onChange={e => updateField('systemPrompt', e.target.value)}
                    rows={4}
                    className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 font-mono resize-y"
                />
            </div>
        </div>
    );
};

/* ============ CLI 配置面板 ============ */

const CliConfigPanel: React.FC<{
    config: Record<string, any>;
    onChange: (config: Record<string, any>) => void;
}> = ({ config, onChange }) => {
    const models = Array.isArray(config.models)
        ? config.models
        : (config.model ? [config.model] : []);
    const timeout = config.timeout ?? 120;
    const systemPrompt = config.systemPrompt || '';

    const updateField = (field: string, value: any) => {
        onChange({ ...config, [field]: value });
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs text-slate-500 mb-1 block">Models（按优先级排列，逗号分隔）</label>
                    <input
                        type="text"
                        value={models.join(', ')}
                        onChange={e => {
                            const arr = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                            onChange({ ...config, models: arr });
                        }}
                        placeholder="gemini-2.5-flash, gemini-2.0-flash"
                        className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                    />
                    <p className="text-xs text-slate-600 mt-0.5">第一个失败时自动切换到下一个</p>
                </div>
                <div>
                    <label className="text-xs text-slate-500 mb-1 block">Timeout（秒）</label>
                    <input
                        type="number"
                        value={timeout}
                        onChange={e => updateField('timeout', parseInt(e.target.value) || 120)}
                        className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                    />
                </div>
            </div>

            <div>
                <label className="text-xs text-slate-500 mb-1 block">System Prompt</label>
                <textarea
                    value={systemPrompt}
                    onChange={e => updateField('systemPrompt', e.target.value)}
                    rows={8}
                    placeholder="You are a professional translator..."
                    className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 font-mono resize-y"
                />
                <p className="text-xs text-slate-600 mt-1">
                    占位符：
                    <code className="bg-slate-700/50 px-1 rounded mx-1">{'${TARGET_LANG}'}</code> 目标语言 ·
                    <code className="bg-slate-700/50 px-1 rounded mx-1">{'${TICKET_CONTENT}'}</code> 工单内容
                </p>
            </div>
        </div>
    );
};

/* ============ Shadow Window 配置面板 ============ */

const ShadowWindowConfigPanel: React.FC<{
    config: Record<string, any>;
    onChange: (config: Record<string, any>) => void;
    capability?: string;
}> = ({ config, onChange, capability }) => {
    const windowLabel = config.windowLabel || '';
    const notebookUrl = config.notebookUrl || '';
    const notebookId = config.notebookId || '';
    const prompt = config.prompt || '';

    const isNotebook = capability === 'reply';

    const updateField = (field: string, value: any) => {
        onChange({ ...config, [field]: value });
    };

    const handleUrlChange = (url: string) => {
        const updates: Record<string, any> = { ...config, notebookUrl: url };
        // 自动从 URL 提取 Notebook ID
        const match = url.match(/notebook\/([a-f0-9-]+)/);
        if (match) {
            updates.notebookId = match[1];
        }
        onChange(updates);
    };

    return (
        <div className="space-y-3">
            <div>
                <label className="text-xs text-slate-500 mb-1 block">Window Label</label>
                <input
                    type="text"
                    value={windowLabel}
                    onChange={e => updateField('windowLabel', e.target.value)}
                    placeholder="notebook_shadow"
                    className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                />
            </div>

            {isNotebook && (
                <>
                    <div>
                        <label className="text-xs text-slate-500 mb-1 block">NotebookLM URL</label>
                        <input
                            type="text"
                            value={notebookUrl}
                            onChange={e => handleUrlChange(e.target.value)}
                            placeholder="https://notebooklm.google.com/notebook/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                            className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500 mb-1 block">
                            Notebook ID
                            <span className="text-slate-600 ml-1">（从 URL 自动提取）</span>
                        </label>
                        <input
                            type="text"
                            value={notebookId}
                            onChange={e => updateField('notebookId', e.target.value)}
                            placeholder="自动从 URL 提取，或手动输入"
                            className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500 mb-1 block">Prompt 模板</label>
                        <textarea
                            value={prompt}
                            onChange={e => updateField('prompt', e.target.value)}
                            rows={4}
                            placeholder="请使用用户工单的语言...&#10;&#10;${工单内容}"
                            className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 font-mono resize-y"
                        />
                        <p className="text-xs text-slate-600 mt-1">使用 <code className="bg-slate-700/50 px-1 rounded">${'${工单内容}'}</code> 作为工单内容占位符</p>
                    </div>
                </>
            )}
        </div>
    );
};

/* ============ 编辑弹窗 ============ */

const EditModal: React.FC<{
    def: Partial<AgentDefinition>;
    onChange: (def: Partial<AgentDefinition>) => void;
    onSave: () => void;
    onCancel: () => void;
    saving: boolean;
}> = ({ def, onChange, onSave, onCancel, saving }) => {
    const isHttpApi = def.providerType === 'HTTP_API';
    const isShadowWindow = def.providerType === 'SHADOW_WINDOW';
    const isLocalCli = def.providerType === 'LOCAL_CLI';

    // 解析 providerConfig
    const parsedConfig: Record<string, any> = (() => {
        if (typeof def.providerConfig === 'object' && def.providerConfig !== null) return def.providerConfig as Record<string, any>;
        try { return JSON.parse(def.providerConfig as string || '{}'); } catch { return {}; }
    })();

    const configStr = typeof def.providerConfig === 'object'
        ? JSON.stringify(def.providerConfig, null, 2)
        : (def.providerConfig || '{}');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-slate-800 border border-slate-700 rounded-lg w-[560px] max-h-[80vh] overflow-auto p-6">
                <h3 className="text-slate-200 font-medium mb-4">
                    {def.id ? '编辑 Agent' : '新建 Agent'}
                </h3>

                <div className="space-y-3">
                    <Field label="Code" value={def.code || ''} onChange={v => onChange({ ...def, code: v })} disabled={!!def.id} />
                    <Field label="名称" value={def.name || ''} onChange={v => onChange({ ...def, name: v })} />
                    <Field label="描述" value={def.description || ''} onChange={v => onChange({ ...def, description: v })} />
                    <Field label="能力标签" value={def.capability || ''} onChange={v => onChange({ ...def, capability: v })} placeholder="translation / reply / tracking / summary" />

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-500 mb-1 block">Provider Type</label>
                            <select
                                value={def.providerType || 'HTTP_API'}
                                onChange={e => onChange({ ...def, providerType: e.target.value as any })}
                                className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                            >
                                <option value="LOCAL_CLI">LOCAL_CLI</option>
                                <option value="HTTP_API">HTTP_API</option>
                                <option value="SHADOW_WINDOW">SHADOW_WINDOW</option>
                                <option value="LOCAL_FUNCTION">LOCAL_FUNCTION</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 mb-1 block">Execution Env</label>
                            <select
                                value={def.executionEnv || 'BOTH'}
                                onChange={e => onChange({ ...def, executionEnv: e.target.value as any })}
                                className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                            >
                                <option value="CLIENT_ONLY">CLIENT_ONLY</option>
                                <option value="SERVER_ONLY">SERVER_ONLY</option>
                                <option value="BOTH">BOTH</option>
                            </select>
                        </div>
                    </div>

                    {/* 按 providerType 分支渲染配置面板 */}
                    {isHttpApi ? (
                        <HttpApiConfigPanel
                            config={parsedConfig}
                            onChange={newConfig => onChange({ ...def, providerConfig: newConfig })}
                        />
                    ) : isShadowWindow ? (
                        <ShadowWindowConfigPanel
                            config={parsedConfig}
                            onChange={newConfig => onChange({ ...def, providerConfig: newConfig })}
                            capability={def.capability}
                        />
                    ) : isLocalCli ? (
                        <CliConfigPanel
                            config={parsedConfig}
                            onChange={newConfig => onChange({ ...def, providerConfig: newConfig })}
                        />
                    ) : (
                        <div>
                            <label className="text-xs text-slate-500 mb-1 block">Provider Config (JSON)</label>
                            <textarea
                                value={configStr}
                                onChange={e => {
                                    try {
                                        const parsed = JSON.parse(e.target.value);
                                        onChange({ ...def, providerConfig: parsed });
                                    } catch {
                                        onChange({ ...def, providerConfig: e.target.value as any });
                                    }
                                }}
                                rows={5}
                                className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 font-mono resize-y"
                            />
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-slate-700">
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-300"
                    >
                        取消
                    </button>
                    <button
                        onClick={onSave}
                        disabled={saving || !def.code || !def.name}
                        className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 transition-colors"
                    >
                        {saving ? '保存中...' : '保存'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const Field: React.FC<{
    label: string;
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
    placeholder?: string;
}> = ({ label, value, onChange, disabled, placeholder }) => (
    <div>
        <label className="text-xs text-slate-500 mb-1 block">{label}</label>
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            placeholder={placeholder}
            className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 disabled:opacity-50"
        />
    </div>
);

const LoadingSpinner: React.FC = () => (
    <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-600 border-t-blue-400" />
    </div>
);

export default AgentManageTab;
