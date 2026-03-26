import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, Power, Zap, AlertTriangle, Bot, ArrowRight, Settings, ChevronDown, ChevronRight, Save, Pencil } from 'lucide-react';
import { agentApi, userAgentApi } from '../../../shared/services/api/agent';
import { useAgentContext } from '../../../shared/agents/AgentContext';
import { useToast } from '../../../shared/hooks/useToast';
import type { UserAgentConfigDTO, AgentDefinition } from '../../../shared/types/server';
import { AgentEditModal } from '../components/AgentEditModal';

/** Agent 可配置参数的 Schema 项 */
interface ConfigSchemaField {
    type: 'string' | 'number' | 'boolean' | 'select';
    label: string;
    required?: boolean;
    description?: string;
    default?: any;
    options?: { label: string; value: string }[];  // for select type
}

type ConfigSchema = Record<string, ConfigSchemaField>;

/** 解析 userConfigSchema JSON */
function parseSchema(schemaStr?: string): ConfigSchema | null {
    if (!schemaStr) return null;
    try {
        const parsed = JSON.parse(schemaStr);
        if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
            return parsed as ConfigSchema;
        }
        return null;
    } catch {
        return null;
    }
}

/** 解析 customConfig JSON */
function parseConfig(configStr?: string): Record<string, any> {
    if (!configStr) return {};
    try {
        return JSON.parse(configStr);
    } catch {
        return {};
    }
}

/** 可折叠的 Agent 参数配置面板 */
const AgentConfigPanel: React.FC<{
    agentCode: string;
    schema: ConfigSchema;
    initialConfig: Record<string, any>;
    disabled?: boolean;
    onSave: (configJson: string) => Promise<void>;
}> = ({ schema, initialConfig, disabled, onSave }) => {
    const [expanded, setExpanded] = useState(false);
    const [values, setValues] = useState<Record<string, any>>(() => {
        // 初始化：优先用已保存的值，否则用 schema 默认值
        const init: Record<string, any> = {};
        for (const [key, field] of Object.entries(schema)) {
            init[key] = initialConfig[key] ?? field.default ?? '';
        }
        return init;
    });
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    const handleChange = (key: string, value: any) => {
        setValues(prev => ({ ...prev, [key]: value }));
        setDirty(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(JSON.stringify(values));
            setDirty(false);
        } finally {
            setSaving(false);
        }
    };

    const fields = Object.entries(schema);

    return (
        <div className="mb-3">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 transition-colors"
            >
                {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <Settings className="w-3 h-3" />
                <span>参数配置</span>
                {dirty && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
            </button>

            {expanded && (
                <div className="mt-2 pl-5 space-y-3">
                    {fields.map(([key, field]) => (
                        <div key={key}>
                            <label className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                                {field.label || key}
                                {field.required && <span className="text-red-400">*</span>}
                            </label>
                            {field.type === 'boolean' ? (
                                <button
                                    onClick={() => handleChange(key, !values[key])}
                                    disabled={disabled}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                                    } ${values[key] ? 'bg-blue-600' : 'bg-slate-600'}`}
                                >
                                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                        values[key] ? 'translate-x-4.5' : 'translate-x-0.5'
                                    }`} />
                                </button>
                            ) : field.type === 'select' ? (
                                <select
                                    value={values[key] || ''}
                                    onChange={e => handleChange(key, e.target.value)}
                                    disabled={disabled}
                                    className="w-full bg-slate-900/50 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                                >
                                    <option value="">请选择...</option>
                                    {field.options?.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type={field.type === 'number' ? 'number' : 'text'}
                                    value={values[key] ?? ''}
                                    onChange={e => handleChange(key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                                    disabled={disabled}
                                    placeholder={field.description || ''}
                                    className="w-full bg-slate-900/50 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono disabled:opacity-50"
                                />
                            )}
                            {field.description && field.type !== 'boolean' && (
                                <p className="text-[10px] text-slate-500 mt-0.5">{field.description}</p>
                            )}
                        </div>
                    ))}

                    {/* 保存按钮 */}
                    <button
                        onClick={handleSave}
                        disabled={!dirty || saving || disabled}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                            dirty && !saving && !disabled
                                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        }`}
                    >
                        <Save className="w-3 h-3" />
                        {saving ? '保存中...' : '保存参数'}
                    </button>
                </div>
            )}
        </div>
    );
};

const MyAgentsTab: React.FC = () => {
    const { reload, capabilityStatus, canExecute, modelMap, capabilities } = useAgentContext();
    const { toast } = useToast();

    const [agents, setAgents] = useState<UserAgentConfigDTO[]>([]);
    const [loading, setLoading] = useState(true);
    const [operating, setOperating] = useState<string | null>(null); // agentCode being operated
    // 退订确认弹窗状态：null 表示不显示，否则保存待退订的 agent 信息
    const [unsubConfirm, setUnsubConfirm] = useState<{ agentCode: string; agentName: string } | null>(null);
    // 编辑弹窗状态
    const [editingDef, setEditingDef] = useState<Partial<AgentDefinition> | null>(null);
    const [saving, setSaving] = useState(false);

    const fetchAgents = useCallback(async () => {
        try {
            setLoading(true);
            const data = await userAgentApi.getUserAgents();
            setAgents(data);
        } catch (err: any) {
            toast('error', '加载失败: ' + (err.message || '未知错误'));
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAgents();
    }, [fetchAgents]);

    const handleToggleAutoStart = async (agentCode: string, current: boolean) => {
        if (operating) return;
        setOperating(agentCode);
        try {
            const updated = await userAgentApi.updateConfig(agentCode, { autoStart: !current });
            setAgents(prev => prev.map(a => a.agentCode === agentCode ? { ...a, autoStart: updated.autoStart } : a));
            await reload();
            toast('success', `${agentCode} 自动启动已${!current ? '开启' : '关闭'}`);
        } catch (err: any) {
            toast('error', err.message || '操作失败');
        } finally {
            setOperating(null);
        }
    };

    const handleToggleEnabled = async (agentCode: string, current: boolean) => {
        if (operating) return;
        setOperating(agentCode);
        try {
            const updated = await userAgentApi.updateConfig(agentCode, { enabled: !current });
            setAgents(prev => prev.map(a => a.agentCode === agentCode ? { ...a, enabled: updated.enabled } : a));
            await reload();
            toast('success', `${agentCode} 已${!current ? '启用' : '禁用'}`);
        } catch (err: any) {
            toast('error', err.message || '操作失败');
        } finally {
            setOperating(null);
        }
    };

    // 第一步：点击退订按钮，仅显示确认弹窗，不执行任何 API 调用
    const handleUnsubscribeClick = (agentCode: string, agentName: string) => {
        if (operating) return;
        setUnsubConfirm({ agentCode, agentName });
    };

    // 第二步：用户在确认弹窗中点击「确认」后，才执行退订操作
    const handleUnsubscribeConfirm = async () => {
        if (!unsubConfirm || operating) return;
        const { agentCode, agentName } = unsubConfirm;
        setUnsubConfirm(null);
        setOperating(agentCode);
        try {
            await userAgentApi.unsubscribe(agentCode);
            setAgents(prev => prev.filter(a => a.agentCode !== agentCode));
            await reload();
            toast('success', `已退订 ${agentName || agentCode}`);
        } catch (err: any) {
            toast('error', err.message || '退订失败');
        } finally {
            setOperating(null);
        }
    };

    // 编辑 Agent 定义
    const handleEdit = async (agentCode: string) => {
        try {
            const defs = await agentApi.getDefinitions();
            const def = defs.find(d => d.code === agentCode);
            if (def) {
                setEditingDef({ ...def });
            } else {
                toast('error', '找不到 Agent 定义');
            }
        } catch (err: any) {
            toast('error', '加载 Agent 定义失败: ' + (err.message || '未知错误'));
        }
    };

    const handleSaveDef = async () => {
        if (!editingDef) return;
        setSaving(true);
        try {
            const payload: any = { ...editingDef };
            if (typeof payload.agentConfig === 'object' && payload.agentConfig !== null) {
                const { systemPrompt: _removed, ...cleanConfig } = payload.agentConfig;
                payload.agentConfig = JSON.stringify(cleanConfig);
            }
            if (typeof payload.inputSchema === 'object' && payload.inputSchema !== null) {
                payload.inputSchema = JSON.stringify(payload.inputSchema);
            }
            if (typeof payload.outputSchema === 'object' && payload.outputSchema !== null) {
                payload.outputSchema = JSON.stringify(payload.outputSchema);
            }

            if (editingDef.id) {
                await agentApi.updateDefinition(editingDef.id, payload);
            }
            setEditingDef(null);
            await fetchAgents();
            await reload();
            toast('success', '保存成功');
        } catch (err: any) {
            toast('error', err.message || '保存失败');
        } finally {
            setSaving(false);
        }
    };

    // Toggle Switch 组件
    const Toggle: React.FC<{ checked: boolean; onChange: () => void; disabled?: boolean; label: string }> = ({ checked, onChange, disabled, label }) => (
        <button
            onClick={onChange}
            disabled={disabled}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            } ${checked ? 'bg-blue-600' : 'bg-slate-600'}`}
            title={label}
        >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                checked ? 'translate-x-4.5' : 'translate-x-0.5'
            }`} />
        </button>
    );

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-400" />
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* 退订确认弹窗 */}
            {unsubConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-sm mx-4 shadow-2xl">
                        <h3 className="text-white font-medium mb-2">确认退订</h3>
                        <p className="text-sm text-slate-300 mb-5">
                            确定退订 &ldquo;{unsubConfirm.agentName || unsubConfirm.agentCode}&rdquo;？退订后将不再自动执行该 Agent 的任务。
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setUnsubConfirm(null)}
                                className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleUnsubscribeConfirm}
                                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
                            >
                                确认退订
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
                <div>
                    <h1 className="text-lg font-semibold text-white">我的 Agent</h1>
                    <p className="text-xs text-slate-400 mt-0.5">管理已订阅的 Agent，配置自动启动和启停状态</p>
                </div>
                <button
                    onClick={fetchAgents}
                    className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                    title="刷新"
                >
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {agents.length === 0 ? (
                    /* 空状态 */
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <Bot className="w-16 h-16 mb-4 opacity-30" />
                        <p className="text-lg font-medium mb-2">还没有订阅任何 Agent</p>
                        <p className="text-sm text-slate-500 mb-4">去 Agent 市场浏览并订阅你需要的 Agent</p>
                        <div className="flex items-center gap-1.5 text-blue-400 text-sm">
                            <span>前往 Agent 市场</span>
                            <ArrowRight className="w-4 h-4" />
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3 max-w-3xl">
                        {agents.map(agent => (
                            <div
                                key={agent.agentCode}
                                className={`rounded-xl border p-4 transition-all ${
                                    !agent.agentEnabled
                                        ? 'border-amber-500/20 bg-amber-500/5'
                                        : agent.enabled
                                            ? 'border-slate-700/50 bg-slate-800/50 hover:border-slate-600/50'
                                            : 'border-slate-700/30 bg-slate-800/30 opacity-60'
                                }`}
                            >
                                {/* 第一行：名称 + 状态标签 */}
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Bot className="w-4 h-4 text-blue-400" />
                                        <span className="text-sm font-medium text-white">{agent.agentName || agent.agentCode}</span>
                                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700/50 text-slate-400 font-mono">
                                            {agent.agentCode}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!agent.agentEnabled && (
                                            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                                                <AlertTriangle className="w-3 h-3" />
                                                全局已禁用
                                            </span>
                                        )}
                                        {agent.requiredCapability && (
                                            <span className={`px-2 py-0.5 text-[10px] rounded-full border ${
                                                canExecute && capabilityStatus.find(c => c.code === agent.requiredCapability && c.available)
                                                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                                                    : 'bg-purple-500/10 border-purple-500/20 text-purple-300'
                                            }`}>
                                                {agent.requiredCapability}
                                                {canExecute && !capabilityStatus.find(c => c.code === agent.requiredCapability && c.available) && (
                                                    <span className="ml-1 text-amber-400" title="当前客户端不具备此能力">&#9888;</span>
                                                )}
                                            </span>
                                        )}
                                        {agent.groupCode && (
                                            <span className="px-2 py-0.5 text-[10px] rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">
                                                {agent.groupCode}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* 描述 */}
                                {agent.description && (
                                    <p className="text-xs text-slate-400 mb-3 line-clamp-2">{agent.description}</p>
                                )}

                                {/* 动态参数配置（含模型选择） */}
                                {(() => {
                                    const baseSchema = parseSchema(agent.userConfigSchema);
                                    const capModels = agent.requiredCapability ? modelMap[agent.requiredCapability] : undefined;
                                    const existingConfig = parseConfig(agent.customConfig);

                                    // 动态注入 model 字段（如果 capability 有可用模型）
                                    let schema: ConfigSchema | null = baseSchema;
                                    if (capModels && capModels.length > 0) {
                                        const modelField: ConfigSchemaField = {
                                            type: 'select',
                                            label: '模型',
                                            required: false,
                                            description: '选择执行时使用的模型',
                                            options: capModels.map(m => ({ label: m, value: m })),
                                        };
                                        schema = { model: modelField, ...(baseSchema || {}) };
                                    }

                                    // 无 schema 但有已存在的 customConfig：自动生成 schema
                                    if (!schema && Object.keys(existingConfig).length > 0) {
                                        const autoSchema: ConfigSchema = {};
                                        for (const [key, value] of Object.entries(existingConfig)) {
                                            autoSchema[key] = {
                                                type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string',
                                                label: key,
                                                required: false,
                                            };
                                        }
                                        schema = autoSchema;
                                    }

                                    if (!schema) return null;

                                    const onSave = async (configJson: string) => {
                                        setOperating(agent.agentCode);
                                        try {
                                            const updated = await userAgentApi.updateConfig(agent.agentCode, { customConfig: configJson });
                                            setAgents(prev => prev.map(a => a.agentCode === agent.agentCode
                                                ? { ...a, customConfig: updated.customConfig } : a));
                                            await reload();
                                            toast('success', `${agent.agentName || agent.agentCode} 参数已保存`);
                                        } catch (err: any) {
                                            toast('error', err.message || '保存失败');
                                        } finally {
                                            setOperating(null);
                                        }
                                    };

                                    return (
                                        <AgentConfigPanel
                                            agentCode={agent.agentCode}
                                            schema={schema}
                                            initialConfig={existingConfig}
                                            disabled={operating === agent.agentCode}
                                            onSave={onSave}
                                        />
                                    );
                                })()}

                                {/* 操作行 */}
                                <div className="flex items-center justify-between pt-2 border-t border-slate-700/30">
                                    <div className="flex items-center gap-6">
                                        {/* 自动启动 */}
                                        <div className="flex items-center gap-2">
                                            <Zap className="w-3.5 h-3.5 text-slate-500" />
                                            <span className="text-xs text-slate-400">自动启动</span>
                                            <Toggle
                                                checked={agent.autoStart}
                                                onChange={() => handleToggleAutoStart(agent.agentCode, agent.autoStart)}
                                                disabled={operating === agent.agentCode}
                                                label="自动启动"
                                            />
                                        </div>
                                        {/* 启用 */}
                                        <div className="flex items-center gap-2">
                                            <Power className="w-3.5 h-3.5 text-slate-500" />
                                            <span className="text-xs text-slate-400">启用</span>
                                            <Toggle
                                                checked={agent.enabled}
                                                onChange={() => handleToggleEnabled(agent.agentCode, agent.enabled)}
                                                disabled={operating === agent.agentCode}
                                                label="启用"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {/* 编辑 */}
                                        <button
                                            onClick={() => handleEdit(agent.agentCode)}
                                            disabled={operating === agent.agentCode}
                                            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50"
                                        >
                                            <Pencil className="w-3 h-3" />
                                            编辑
                                        </button>
                                        {/* 退订 */}
                                        <button
                                            onClick={() => handleUnsubscribeClick(agent.agentCode, agent.agentName)}
                                            disabled={operating === agent.agentCode}
                                            className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                            退订
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 编辑弹窗 */}
            {editingDef && (
                <AgentEditModal
                    def={editingDef}
                    groupCodes={[]}
                    capabilities={capabilities}
                    onChange={setEditingDef}
                    onSave={handleSaveDef}
                    onCancel={() => setEditingDef(null)}
                    saving={saving}
                />
            )}
        </div>
    );
};

export default MyAgentsTab;
