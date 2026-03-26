/**
 * Agent 编辑弹窗 — 共享组件
 *
 * 被 WorkflowAgentsTab（Agent 市场）和 MyAgentsTab（我的 Agent）复用
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentDefinition, CapabilityDefinition } from '../../../shared/types/server';
import { PROMPT_TEMPLATES, TEMPLATE_CATEGORIES } from '../../../shared/agents/promptTemplates';

// ============ 模块定义 ============

import { Headphones, Settings } from 'lucide-react';

const MODULE_DEFS = [
    { code: 'ticket', name: '工单中心', icon: Headphones },
    { code: 'admin', name: '管理后台', icon: Settings },
] as const;

// ============ 编辑弹窗 ============

type EditSection = 'basic' | 'execution' | 'schema';

export const AgentEditModal: React.FC<{
    def: Partial<AgentDefinition>;
    groupCodes: string[];
    capabilities: CapabilityDefinition[];
    onChange: (def: Partial<AgentDefinition>) => void;
    onSave: () => void;
    onCancel: () => void;
    saving: boolean;
}> = ({ def, groupCodes: _groupCodes, capabilities, onChange, onSave, onCancel, saving }) => {
    const [activeSection, setActiveSection] = useState<EditSection>('basic');

    // 解析 agentConfig（排除 systemPrompt，它已提升为独立字段）
    const parsedConfig: Record<string, any> = useMemo(() => {
        let raw: Record<string, any>;
        if (typeof def.agentConfig === 'object' && def.agentConfig !== null) {
            raw = def.agentConfig as Record<string, any>;
        } else {
            try { raw = JSON.parse(def.agentConfig as string || '{}'); } catch { raw = {}; }
        }
        // 移除 systemPrompt，避免重复编辑
        const { systemPrompt: _removed, ...rest } = raw;
        return rest;
    }, [def.agentConfig]);

    // 从匹配的 Capability 解析 configSchema
    const parsedConfigSchema = useMemo(() => {
        if (!def.requiredCapability) return undefined;
        const cap = capabilities.find(c => c.code === def.requiredCapability);
        if (!cap?.configSchema) return undefined;
        try {
            return JSON.parse(cap.configSchema) as Record<string, { type: string; label: string; required?: boolean; description?: string }>;
        } catch {
            return undefined;
        }
    }, [def.requiredCapability, capabilities]);

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

                            {/* 分组 - 下拉选择 */}
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block">分组 (groupCode)</label>
                                <select
                                    value={def.groupCode || ''}
                                    onChange={e => onChange({ ...def, groupCode: e.target.value || '' })}
                                    className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                                >
                                    <option value="">未分组</option>
                                    {MODULE_DEFS.map(mod => (
                                        <option key={mod.code} value={mod.code}>
                                            {mod.name} ({mod.code})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <Field
                                label="能力标签 (capability)"
                                value={def.capability || ''}
                                onChange={v => onChange({ ...def, capability: v })}
                                placeholder="translation / reply / tracking / summary"
                            />

                            <div>
                                <label className="text-xs text-slate-500 mb-1 block">依赖能力 (requiredCapability)</label>
                                <select
                                    value={def.requiredCapability || ''}
                                    onChange={e => onChange({ ...def, requiredCapability: e.target.value || undefined })}
                                    className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                                >
                                    <option value="">无依赖</option>
                                    {capabilities.map(cap => (
                                        <option key={cap.code} value={cap.code}>
                                            {cap.name} ({cap.code})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-xs text-slate-500 mb-1 block">排序 (sortOrder)</label>
                                <input
                                    type="number"
                                    value={def.sortOrder ?? 0}
                                    onChange={e => onChange({ ...def, sortOrder: parseInt(e.target.value) || 0 })}
                                    className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5"
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <div>
                                    <label className="text-xs text-slate-500 block">自动启动</label>
                                    <p className="text-[10px] text-slate-600 mt-0.5">打开 Agent 面板时自动启动 MQ Consumer</p>
                                </div>
                                <button
                                    onClick={() => onChange({ ...def, autoStart: !def.autoStart })}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                        def.autoStart ? 'bg-blue-600' : 'bg-slate-600'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                                            def.autoStart ? 'translate-x-4' : 'translate-x-0.5'
                                        }`}
                                    />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 执行配置 */}
                    {activeSection === 'execution' && (
                        <div className="space-y-4">
                            <UnifiedConfigPanel
                                systemPrompt={def.systemPrompt || ''}
                                config={parsedConfig}
                                configSchema={parsedConfigSchema}
                                onSystemPromptChange={prompt => onChange({ ...def, systemPrompt: prompt })}
                                onConfigChange={newConfig => onChange({ ...def, agentConfig: newConfig })}
                            />
                        </div>
                    )}

                    {/* I/O Schema */}
                    {activeSection === 'schema' && (
                        <div className="space-y-4">
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

// ============ 统一 Agent 配置面板 ============

const UnifiedConfigPanel: React.FC<{
    systemPrompt: string;
    config: Record<string, any>;
    configSchema?: Record<string, { type: string; label: string; required?: boolean; description?: string }>;
    onSystemPromptChange: (prompt: string) => void;
    onConfigChange: (config: Record<string, any>) => void;
}> = ({ systemPrompt, config, configSchema, onSystemPromptChange, onConfigChange }) => {
    const { i18n } = useTranslation();
    const isZh = i18n.language?.startsWith('zh');

    return (
        <div className="space-y-4">
            {/* System Prompt */}
            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm text-slate-300">提示词 (System Prompt)</label>
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-500">模板</label>
                        <select
                            className="bg-slate-700 text-slate-300 text-xs px-2 py-1 rounded border border-slate-600 hover:border-slate-500 transition-colors cursor-pointer max-w-[200px]"
                            value=""
                            onChange={(e) => {
                                const template = PROMPT_TEMPLATES.find(t => t.id === e.target.value);
                                if (template) {
                                    onSystemPromptChange(template.prompt);
                                }
                            }}
                        >
                            <option value="">选择模板...</option>
                            {Object.entries(TEMPLATE_CATEGORIES).map(([catKey, cat]) => (
                                <optgroup key={catKey} label={isZh ? cat.label : cat.labelEn}>
                                    {PROMPT_TEMPLATES.filter(t => t.category === catKey).map(t => (
                                        <option key={t.id} value={t.id}>
                                            {isZh ? t.name : t.nameEn}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                </div>
                <textarea
                    value={systemPrompt || ''}
                    onChange={e => onSystemPromptChange(e.target.value)}
                    rows={10}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-slate-200 font-mono resize-y"
                    placeholder="输入 Agent 的系统提示词..."
                />
                <p className="mt-1 text-xs text-slate-500">
                    支持模板变量：{'{{fieldName}}'} — input 中的字段名自动成为模板变量（如 {'{{ticket}}'}, {'{{targetLang}}'}）
                </p>
            </div>

            {/* 根据 configSchema 动态渲染额外参数 */}
            {configSchema && Object.entries(configSchema).map(([key, schema]) => (
                <div key={key}>
                    <label className="block text-sm text-slate-300 mb-1">
                        {schema.label}
                        {schema.required && <span className="text-red-400 ml-1">*</span>}
                    </label>
                    <input
                        type="text"
                        value={config[key] || ''}
                        onChange={e => onConfigChange({ ...config, [key]: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-slate-200"
                        placeholder={schema.description || ''}
                    />
                    {schema.description && (
                        <p className="mt-1 text-xs text-slate-500">{schema.description}</p>
                    )}
                </div>
            ))}
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

export default AgentEditModal;
