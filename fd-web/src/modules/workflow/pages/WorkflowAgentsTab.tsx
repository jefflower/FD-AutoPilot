/**
 * 工作流中心 - Agent 管理页面
 *
 * 功能：Agent 分组展示、CRUD、inputSchema/outputSchema 编辑、Provider 配置
 * 从管理后台 AgentManageTab 迁移并增强
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { agentApi } from '../../../shared/services/serverApi';
import type { AgentDefinition, AgentProxyTestResult } from '../../../shared/types/server';
import { useAgentContext } from '../../../shared/agents';

// ============ 常量 ============

const PROVIDER_TYPE_LABELS: Record<string, { label: string; color: string }> = {
    GEMINI_CLI: { label: 'Gemini CLI', color: 'bg-green-500/20 text-green-400' },
    HTTP_API: { label: 'HTTP API', color: 'bg-blue-500/20 text-blue-400' },
    WEB_AUTOMATION: { label: 'Web Auto', color: 'bg-purple-500/20 text-purple-400' },
    LOCAL_FUNCTION: { label: 'Function', color: 'bg-amber-500/20 text-amber-400' },
    // 向后兼容旧值
    LOCAL_CLI: { label: 'CLI (legacy)', color: 'bg-green-500/20 text-green-400' },
    SHADOW_WINDOW: { label: 'Shadow (legacy)', color: 'bg-purple-500/20 text-purple-400' },
};

const CALL_MODE_LABELS: Record<string, { label: string; color: string }> = {
    HTTP: { label: 'HTTP', color: 'bg-cyan-500/20 text-cyan-400' },
    MQ: { label: 'MQ', color: 'bg-orange-500/20 text-orange-400' },
};

const ENV_LABELS: Record<string, string> = {
    CLIENT_ONLY: 'Client',
    SERVER_ONLY: 'Server',
    BOTH: 'Both',
};

const UNGROUPED_KEY = '__ungrouped__';

// ============ 主组件 ============

const WorkflowAgentsTab: React.FC = () => {
    const { t } = useTranslation(['common']);
    const { reload: reloadAgentContext } = useAgentContext();

    const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
    const [groupCodes, setGroupCodes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [operating, setOperating] = useState<number | null>(null);

    // 分组折叠状态
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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
            const [defs, groups] = await Promise.all([
                agentApi.getAllDefinitions(),
                agentApi.getGroupCodes(),
            ]);
            setDefinitions(defs);
            setGroupCodes(groups);
        } catch (err: any) {
            setError(err.message || '加载 Agent 列表失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDefinitions();
    }, [loadDefinitions]);

    // 按 groupCode 分组
    const groupedDefinitions = useMemo(() => {
        const groups: Record<string, AgentDefinition[]> = {};
        for (const def of definitions) {
            const key = def.groupCode || UNGROUPED_KEY;
            if (!groups[key]) groups[key] = [];
            groups[key].push(def);
        }
        // 每组按 sortOrder 排序
        for (const key of Object.keys(groups)) {
            groups[key].sort((a, b) => a.sortOrder - b.sortOrder);
        }
        return groups;
    }, [definitions]);

    // 分组键排序：有名称的组在前，未分组在最后
    const sortedGroupKeys = useMemo(() => {
        const keys = Object.keys(groupedDefinitions);
        return keys.sort((a, b) => {
            if (a === UNGROUPED_KEY) return 1;
            if (b === UNGROUPED_KEY) return -1;
            return a.localeCompare(b);
        });
    }, [groupedDefinitions]);

    const toggleGroupCollapse = (groupKey: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return next;
        });
    };

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
        if (!confirm('确定要删除这个 Agent 定义吗？此操作不可撤销。')) return;
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
            const payload: any = { ...editingDef };

            // providerConfig: 对象需要序列化为字符串
            if (typeof payload.providerConfig === 'object' && payload.providerConfig !== null) {
                payload.providerConfig = JSON.stringify(payload.providerConfig);
            }
            // inputSchema: 对象需要序列化为字符串
            if (typeof payload.inputSchema === 'object' && payload.inputSchema !== null) {
                payload.inputSchema = JSON.stringify(payload.inputSchema);
            }
            // outputSchema: 对象需要序列化为字符串
            if (typeof payload.outputSchema === 'object' && payload.outputSchema !== null) {
                payload.outputSchema = JSON.stringify(payload.outputSchema);
            }

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

    const handleCreate = () => {
        setEditingDef({
            code: '',
            name: '',
            description: '',
            providerType: 'HTTP_API',
            executionEnv: 'BOTH',
            capability: '',
            groupCode: '',
            callMode: undefined,
            callUrl: '',
            providerConfig: {},
            inputSchema: undefined,
            outputSchema: undefined,
            templateEngine: '',
            enabled: true,
            sortOrder: 0,
        });
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* 消息提示 */}
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

            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-700/50">
                <div>
                    <h2 className="text-slate-200 font-medium text-lg">Agent 管理</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                        管理 AI Agent 定义，配置执行参数和输入输出 Schema
                    </p>
                </div>
                <button
                    onClick={handleCreate}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                >
                    + 新建 Agent
                </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-auto p-4">
                {loading ? (
                    <LoadingSpinner />
                ) : definitions.length === 0 ? (
                    <div className="text-center text-slate-500 py-12">暂无 Agent 定义</div>
                ) : (
                    <div className="space-y-4">
                        {sortedGroupKeys.map(groupKey => {
                            const agents = groupedDefinitions[groupKey];
                            const isCollapsed = collapsedGroups.has(groupKey);
                            const groupLabel = groupKey === UNGROUPED_KEY ? '未分组' : groupKey;

                            return (
                                <div key={groupKey} className="border border-slate-700/50 rounded-lg overflow-hidden">
                                    {/* 分组标题 */}
                                    <button
                                        onClick={() => toggleGroupCollapse(groupKey)}
                                        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800/70 hover:bg-slate-800 transition-colors text-left"
                                    >
                                        <div className="flex items-center gap-2">
                                            <svg
                                                className={`w-4 h-4 text-slate-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                                                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                            <span className="text-slate-300 font-medium text-sm">{groupLabel}</span>
                                            <span className="text-xs text-slate-500">({agents.length})</span>
                                        </div>
                                    </button>

                                    {/* 分组内 Agent 列表 */}
                                    {!isCollapsed && (
                                        <div className="divide-y divide-slate-700/30">
                                            {agents.map(def => (
                                                <AgentCard
                                                    key={def.id}
                                                    def={def}
                                                    operating={operating}
                                                    onToggle={handleToggle}
                                                    onDelete={handleDelete}
                                                    onEdit={() => setEditingDef({ ...def })}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 编辑弹窗 */}
            {editingDef && (
                <EditModal
                    def={editingDef}
                    groupCodes={groupCodes}
                    onChange={setEditingDef}
                    onSave={handleSaveDef}
                    onCancel={() => setEditingDef(null)}
                    saving={saving}
                />
            )}
        </div>
    );
};

// ============ Agent 卡片组件 ============

const AgentCard: React.FC<{
    def: AgentDefinition;
    operating: number | null;
    onToggle: (id: number) => void;
    onDelete: (id: number) => void;
    onEdit: () => void;
}> = ({ def, operating, onToggle, onDelete, onEdit }) => (
    <div className={`px-4 py-3 transition-colors ${
        def.enabled
            ? 'bg-slate-800/30'
            : 'bg-slate-900/30 opacity-60'
    }`}>
        <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-200 font-medium text-sm">{def.name}</span>
                    <code className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{def.code}</code>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${PROVIDER_TYPE_LABELS[def.providerType]?.color || 'bg-slate-700 text-slate-400'}`}>
                        {PROVIDER_TYPE_LABELS[def.providerType]?.label || def.providerType}
                    </span>
                    <span className="text-xs text-slate-500">{ENV_LABELS[def.executionEnv] || def.executionEnv}</span>
                    {def.callMode && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${CALL_MODE_LABELS[def.callMode]?.color || 'bg-slate-700 text-slate-400'}`}>
                            {CALL_MODE_LABELS[def.callMode]?.label || def.callMode}
                        </span>
                    )}
                    {def.builtIn && <span className="text-xs text-slate-600 italic">built-in</span>}
                </div>
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                    {def.description && <span>{def.description}</span>}
                    {def.description && def.capability && <span>-</span>}
                    {def.capability && (
                        <span>
                            capability: <code className="text-slate-400">{def.capability}</code>
                        </span>
                    )}
                    {def.inputSchema && (
                        <span className="text-cyan-500/70 text-[10px] bg-cyan-500/10 px-1 rounded">inputSchema</span>
                    )}
                    {def.outputSchema && (
                        <span className="text-cyan-500/70 text-[10px] bg-cyan-500/10 px-1 rounded">outputSchema</span>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 ml-3 flex-shrink-0">
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
                    onClick={onEdit}
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
);

// ============ 编辑弹窗 ============

type EditSection = 'basic' | 'execution' | 'schema';

const EditModal: React.FC<{
    def: Partial<AgentDefinition>;
    groupCodes: string[];
    onChange: (def: Partial<AgentDefinition>) => void;
    onSave: () => void;
    onCancel: () => void;
    saving: boolean;
}> = ({ def, groupCodes, onChange, onSave, onCancel, saving }) => {
    const [activeSection, setActiveSection] = useState<EditSection>('basic');
    const [showGroupSuggestions, setShowGroupSuggestions] = useState(false);

    const isHttpApi = def.providerType === 'HTTP_API';
    const isShadowWindow = def.providerType === 'WEB_AUTOMATION' || def.providerType === 'SHADOW_WINDOW';
    const isLocalCli = def.providerType === 'GEMINI_CLI' || def.providerType === 'LOCAL_CLI';

    // 解析 providerConfig
    const parsedConfig: Record<string, any> = useMemo(() => {
        if (typeof def.providerConfig === 'object' && def.providerConfig !== null) return def.providerConfig as Record<string, any>;
        try { return JSON.parse(def.providerConfig as string || '{}'); } catch { return {}; }
    }, [def.providerConfig]);

    const configStr = typeof def.providerConfig === 'object'
        ? JSON.stringify(def.providerConfig, null, 2)
        : (def.providerConfig || '{}');

    // 分组建议过滤
    const filteredGroupCodes = useMemo(() => {
        const input = (def.groupCode || '').toLowerCase();
        if (!input) return groupCodes;
        return groupCodes.filter(g => g.toLowerCase().includes(input));
    }, [def.groupCode, groupCodes]);

    const sections: { key: EditSection; label: string }[] = [
        { key: 'basic', label: '基本信息' },
        { key: 'execution', label: '执行配置' },
        { key: 'schema', label: 'I/O Schema' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
            <div
                className="bg-slate-800 border border-slate-700 rounded-lg w-[640px] max-h-[85vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* 弹窗标题 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                    <h3 className="text-slate-200 font-medium">
                        {def.id ? '编辑 Agent' : '新建 Agent'}
                    </h3>
                    <button onClick={onCancel} className="text-slate-500 hover:text-slate-300 text-lg">&times;</button>
                </div>

                {/* 分区标签页 */}
                <div className="flex items-center gap-1 px-6 pt-3 pb-2 border-b border-slate-700/50">
                    {sections.map(s => (
                        <button
                            key={s.key}
                            onClick={() => setActiveSection(s.key)}
                            className={`px-3 py-1.5 rounded text-sm transition-colors ${
                                activeSection === s.key
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50'
                            }`}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>

                {/* 表单内容 */}
                <div className="flex-1 overflow-auto px-6 py-4">
                    {/* 基本信息 */}
                    {activeSection === 'basic' && (
                        <div className="space-y-3">
                            <Field
                                label="Code"
                                value={def.code || ''}
                                onChange={v => onChange({ ...def, code: v })}
                                disabled={!!def.id}
                                placeholder="my-agent-code"
                            />
                            <Field
                                label="名称"
                                value={def.name || ''}
                                onChange={v => onChange({ ...def, name: v })}
                                placeholder="我的 Agent"
                            />
                            <Field
                                label="描述"
                                value={def.description || ''}
                                onChange={v => onChange({ ...def, description: v })}
                                placeholder="Agent 功能描述"
                            />

                            {/* 分组 - 带下拉建议 */}
                            <div className="relative">
                                <label className="text-xs text-slate-500 mb-1 block">分组 (groupCode)</label>
                                <input
                                    type="text"
                                    value={def.groupCode || ''}
                                    onChange={e => onChange({ ...def, groupCode: e.target.value })}
                                    onFocus={() => setShowGroupSuggestions(true)}
                                    onBlur={() => setTimeout(() => setShowGroupSuggestions(false), 200)}
                                    placeholder="输入分组名称或选择已有分组"
                                    className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                                />
                                {showGroupSuggestions && filteredGroupCodes.length > 0 && (
                                    <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded shadow-lg max-h-32 overflow-auto">
                                        {filteredGroupCodes.map(g => (
                                            <button
                                                key={g}
                                                onMouseDown={() => {
                                                    onChange({ ...def, groupCode: g });
                                                    setShowGroupSuggestions(false);
                                                }}
                                                className="w-full text-left px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-600 transition-colors"
                                            >
                                                {g}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <Field
                                label="能力标签 (capability)"
                                value={def.capability || ''}
                                onChange={v => onChange({ ...def, capability: v })}
                                placeholder="translation / reply / tracking / summary"
                            />

                            <div>
                                <label className="text-xs text-slate-500 mb-1 block">排序 (sortOrder)</label>
                                <input
                                    type="number"
                                    value={def.sortOrder ?? 0}
                                    onChange={e => onChange({ ...def, sortOrder: parseInt(e.target.value) || 0 })}
                                    className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                                />
                            </div>
                        </div>
                    )}

                    {/* 执行配置 */}
                    {activeSection === 'execution' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block">Provider Type</label>
                                    <select
                                        value={def.providerType || 'HTTP_API'}
                                        onChange={e => onChange({ ...def, providerType: e.target.value as any })}
                                        className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                                    >
                                        <option value="GEMINI_CLI">GEMINI_CLI</option>
                                        <option value="HTTP_API">HTTP_API</option>
                                        <option value="WEB_AUTOMATION">WEB_AUTOMATION</option>
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

                            {/* Call Mode + Call URL */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block">Call Mode（调用方式）</label>
                                    <select
                                        value={def.callMode || ''}
                                        onChange={e => onChange({ ...def, callMode: (e.target.value || undefined) as any })}
                                        className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                                    >
                                        <option value="">未指定</option>
                                        <option value="HTTP">HTTP</option>
                                        <option value="MQ">MQ</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block">Call URL（仅 HTTP 模式）</label>
                                    <input
                                        type="text"
                                        value={def.callUrl || ''}
                                        onChange={e => onChange({ ...def, callUrl: e.target.value })}
                                        placeholder="https://api.example.com/v1/agent"
                                        disabled={def.callMode !== 'HTTP'}
                                        className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 disabled:opacity-50"
                                    />
                                </div>
                            </div>

                            {/* Provider Config - 按 providerType 分支渲染 */}
                            <div className="border-t border-slate-700/50 pt-4">
                                <h4 className="text-xs text-slate-400 font-medium mb-3">Provider 配置</h4>
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
                                            rows={6}
                                            className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 font-mono resize-y"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* I/O Schema */}
                    {activeSection === 'schema' && (
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block">模板引擎 (templateEngine)</label>
                                <select
                                    value={def.templateEngine || ''}
                                    onChange={e => onChange({ ...def, templateEngine: e.target.value })}
                                    className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                                >
                                    <option value="">无</option>
                                    <option value="handlebars">Handlebars</option>
                                    <option value="mustache">Mustache</option>
                                    <option value="simple">Simple (${'{'}...{'}'})</option>
                                </select>
                            </div>

                            <JsonSchemaEditor
                                label="Input Schema"
                                value={def.inputSchema}
                                onChange={v => onChange({ ...def, inputSchema: v })}
                            />

                            <JsonSchemaEditor
                                label="Output Schema"
                                value={def.outputSchema}
                                onChange={v => onChange({ ...def, outputSchema: v })}
                            />
                        </div>
                    )}
                </div>

                {/* 底部操作栏 */}
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-700">
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

// ============ JSON Schema 编辑器 ============

const JsonSchemaEditor: React.FC<{
    label: string;
    value: Record<string, any> | undefined;
    onChange: (v: Record<string, any> | undefined) => void;
}> = ({ label, value, onChange }) => {
    const [text, setText] = useState(() =>
        value ? JSON.stringify(value, null, 2) : ''
    );
    const [jsonError, setJsonError] = useState<string | null>(null);

    // 当外部 value 变化时同步
    useEffect(() => {
        const newText = value ? JSON.stringify(value, null, 2) : '';
        setText(newText);
        setJsonError(null);
    }, [value]);

    const handleTextChange = (newText: string) => {
        setText(newText);
        if (!newText.trim()) {
            setJsonError(null);
            onChange(undefined);
            return;
        }
        try {
            const parsed = JSON.parse(newText);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                setJsonError('必须是 JSON 对象');
                return;
            }
            setJsonError(null);
            onChange(parsed);
        } catch (e: any) {
            setJsonError(e.message || 'JSON 格式错误');
        }
    };

    const handleFormat = () => {
        if (!text.trim()) return;
        try {
            const parsed = JSON.parse(text);
            const formatted = JSON.stringify(parsed, null, 2);
            setText(formatted);
            setJsonError(null);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                onChange(parsed);
            }
        } catch {
            // 格式化失败时不做处理
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-500">{label}</label>
                <button
                    onClick={handleFormat}
                    disabled={!text.trim()}
                    className="text-xs text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
                >
                    格式化
                </button>
            </div>
            <textarea
                value={text}
                onChange={e => handleTextChange(e.target.value)}
                rows={8}
                placeholder={`{\n  "type": "object",\n  "properties": {\n    "field": { "type": "string" }\n  }\n}`}
                className={`w-full bg-slate-700 text-slate-200 text-sm rounded px-2 py-1.5 font-mono resize-y transition-colors ${
                    jsonError
                        ? 'border-2 border-red-500/60'
                        : 'border border-slate-600'
                }`}
            />
            {jsonError && (
                <p className="text-xs text-red-400 mt-1">{jsonError}</p>
            )}
        </div>
    );
};

// ============ HTTP API 配置面板 ============

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

            {/* 代理状态 */}
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

            {/* Model */}
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

// ============ CLI 配置面板 ============

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
                    <label className="text-xs text-slate-500 mb-1 block">Models（逗号分隔，按优先级排列）</label>
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

// ============ Shadow Window 配置面板 ============

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
                            placeholder={'请使用用户工单的语言...\n\n${工单内容}'}
                            className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 font-mono resize-y"
                        />
                        <p className="text-xs text-slate-600 mt-1">
                            使用 <code className="bg-slate-700/50 px-1 rounded">{'${工单内容}'}</code> 作为工单内容占位符
                        </p>
                    </div>
                </>
            )}
        </div>
    );
};

// ============ 通用组件 ============

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

export default WorkflowAgentsTab;
