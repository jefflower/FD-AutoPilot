import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { workflowApi, agentApi } from '../../../shared/services/serverApi';
import type { WorkflowDefinition, AgentDefinition } from '../../../shared/types/server';
import type { BpmnEditorHandle, SelectedBpmnElement } from '../components/BpmnEditor';

const BpmnEditor = lazy(() => import('../components/BpmnEditor'));

// ─── BPMN field extension 工具函数 ───

function getFieldExtensions(businessObject: any): Record<string, string> {
    const fields: Record<string, string> = {};
    const extensions = businessObject?.extensionElements?.values || [];
    for (const ext of extensions) {
        // bpmn-js 解析后 $type 为小写 'flowable:field'
        if (ext.$type?.toLowerCase().includes('field')) {
            fields[ext.name] = ext.stringValue || ext.string || '';
        }
    }
    return fields;
}

function updateFieldExtension(modeler: any, elementId: string, fieldName: string, fieldValue: string) {
    const elementRegistry = modeler.get('elementRegistry');
    const element = elementRegistry.get(elementId);
    if (!element) return;

    const modeling = modeler.get('modeling');
    const moddle = modeler.get('moddle');
    const bo = element.businessObject;

    // 获取或创建 extensionElements
    let extensionElements = bo.extensionElements;
    if (!extensionElements) {
        extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    }

    // 确保 values 数组存在
    if (!extensionElements.values) {
        extensionElements.values = [];
    }

    // 查找现有 field（bpmn-js 解析后 $type 为小写 'flowable:field'）
    const existingField = extensionElements.values.find(
        (v: any) => v.$type?.toLowerCase().includes('field') && v.name === fieldName
    );

    if (existingField) {
        existingField.stringValue = fieldValue;
    } else {
        const newField = moddle.create('flowable:Field', {
            name: fieldName,
            stringValue: fieldValue,
        });
        extensionElements.values = [...extensionElements.values, newField];
    }

    // 通过 modeling API 触发变更（支持 undo/redo）
    modeling.updateProperties(element, { extensionElements });
}

// ─── delegate 类型判断 ───

type DelegateType = 'agent' | 'callback' | 'human' | 'unknown';

function getDelegateType(businessObject: any): DelegateType {
    // bpmn-js 不识别 flowable namespace，delegateExpression 存在 $attrs 中
    const expr = businessObject?.delegateExpression
        || businessObject?.$attrs?.['flowable:delegateExpression']
        || '';
    if (expr.includes('agentTaskDelegate')) return 'agent';
    if (expr.includes('businessCallbackDelegate')) return 'callback';
    if (expr.includes('humanTaskDelegate')) return 'human';
    return 'unknown';
}

// ─── 属性面板子组件 ───

interface PropertiesPanelProps {
    selectedElement: SelectedBpmnElement | null;
    editorRef: React.RefObject<BpmnEditorHandle | null>;
    agents: AgentDefinition[];
    agentsLoading: boolean;
    onFieldChanged: () => void;
}

function PropertiesPanel({ selectedElement, editorRef, agents, agentsLoading, onFieldChanged }: PropertiesPanelProps) {
    if (!selectedElement) {
        return (
            <div className="w-72 shrink-0 border-l border-white/10 bg-slate-900/95 backdrop-blur-sm flex flex-col">
                <div className="flex items-center justify-center h-full text-slate-500 text-xs px-4 text-center">
                    <div>
                        <svg className="w-8 h-8 mx-auto mb-2 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                        </svg>
                        <span>点击选择一个节点<br />查看属性</span>
                    </div>
                </div>
            </div>
        );
    }

    const isServiceTask = selectedElement.type === 'bpmn:ServiceTask';
    const delegateType = isServiceTask ? getDelegateType(selectedElement.businessObject) : 'unknown';
    const fields = getFieldExtensions(selectedElement.businessObject);

    const typeLabel = (() => {
        switch (selectedElement.type) {
            case 'bpmn:ServiceTask': return 'Service Task';
            case 'bpmn:UserTask': return 'User Task';
            case 'bpmn:StartEvent': return 'Start Event';
            case 'bpmn:EndEvent': return 'End Event';
            case 'bpmn:ParallelGateway': return 'Parallel Gateway';
            case 'bpmn:ExclusiveGateway': return 'Exclusive Gateway';
            case 'bpmn:ReceiveTask': return 'Receive Task';
            case 'bpmn:SequenceFlow': return 'Sequence Flow';
            default: return selectedElement.type.replace('bpmn:', '');
        }
    })();

    const delegateLabel = (() => {
        switch (delegateType) {
            case 'agent': return 'Agent Task';
            case 'callback': return 'Business Callback';
            case 'human': return 'Human Task';
            default: return null;
        }
    })();

    const handleUpdateField = (fieldName: string, fieldValue: string) => {
        const modeler = editorRef.current?.getModeler();
        if (!modeler || !selectedElement) return;
        updateFieldExtension(modeler, selectedElement.id, fieldName, fieldValue);
        onFieldChanged();
    };

    return (
        <div className="w-72 shrink-0 border-l border-white/10 bg-slate-900/95 backdrop-blur-sm flex flex-col overflow-hidden">
            {/* 面板头部 */}
            <div className="px-3 py-2.5 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-white truncate flex-1">
                        {selectedElement.name || selectedElement.id}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 text-[10px] bg-slate-700 text-slate-300 rounded">
                        {typeLabel}
                    </span>
                    {delegateLabel && (
                        <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-300 rounded">
                            {delegateLabel}
                        </span>
                    )}
                </div>
            </div>

            {/* 面板内容 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* 基本信息 */}
                <div className="space-y-2">
                    <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                        Basic Info
                    </h4>
                    <div className="space-y-1.5">
                        <div>
                            <label className="text-[10px] text-slate-500">ID</label>
                            <div className="text-xs text-slate-300 font-mono truncate" title={selectedElement.id}>
                                {selectedElement.id}
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500">Type</label>
                            <div className="text-xs text-slate-300">{selectedElement.type}</div>
                        </div>
                    </div>
                </div>

                {/* Agent 配置面板 */}
                {isServiceTask && delegateType === 'agent' && (
                    <AgentConfigPanel
                        fields={fields}
                        agents={agents}
                        agentsLoading={agentsLoading}
                        onUpdateField={handleUpdateField}
                    />
                )}

                {/* 回调配置面板 */}
                {isServiceTask && delegateType === 'callback' && (
                    <CallbackConfigPanel
                        fields={fields}
                        onUpdateField={handleUpdateField}
                    />
                )}

                {/* 人工任务配置面板 */}
                {isServiceTask && delegateType === 'human' && (
                    <HumanTaskConfigPanel
                        fields={fields}
                        onUpdateField={handleUpdateField}
                    />
                )}

                {/* 非 ServiceTask 或 unknown delegate */}
                {(!isServiceTask || (isServiceTask && delegateType === 'unknown')) && (
                    <div className="text-xs text-slate-500 italic">
                        {!isServiceTask
                            ? '此节点类型无额外配置'
                            : '未识别的 delegate 类型'}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Agent 配置子面板 ───

interface AgentConfigPanelProps {
    fields: Record<string, string>;
    agents: AgentDefinition[];
    agentsLoading: boolean;
    onUpdateField: (fieldName: string, fieldValue: string) => void;
}

function AgentConfigPanel({ fields, agents, agentsLoading, onUpdateField }: AgentConfigPanelProps) {
    const currentAgentCode = fields['agentCode'] || '';
    const currentTaskType = fields['taskType'] || '';

    // 按 groupCode 分组，无 groupCode 的归入空字符串组
    const groupedAgents = agents.reduce<Record<string, AgentDefinition[]>>((acc, a) => {
        const group = a.groupCode || '';
        if (!acc[group]) acc[group] = [];
        acc[group].push(a);
        return acc;
    }, {});

    return (
        <div className="space-y-2">
            <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Agent Config
            </h4>

            {/* Agent 选择 */}
            <div>
                <label className="text-[10px] text-slate-500 block mb-1">Agent</label>
                {agentsLoading ? (
                    <div className="text-xs text-slate-500">Loading...</div>
                ) : (
                    <select
                        className="w-full text-xs bg-slate-800 text-slate-200 border border-white/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                        value={currentAgentCode}
                        onChange={(e) => onUpdateField('agentCode', e.target.value)}
                    >
                        <option value="">-- Select Agent --</option>
                        {Object.entries(groupedAgents).map(([group, groupAgents]) => (
                            <optgroup key={group} label={group || '未分组'}>
                                {groupAgents.map(agent => (
                                    <option key={agent.code} value={agent.code}>
                                        {agent.name} ({agent.code})
                                        {!agent.enabled ? ' [disabled]' : ''}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                )}
                {currentAgentCode && (
                    <AgentInfoBadge agents={agents} agentCode={currentAgentCode} />
                )}
            </div>

            {/* taskType */}
            <div>
                <label className="text-[10px] text-slate-500 block mb-1">Task Type</label>
                <input
                    type="text"
                    className="w-full text-xs bg-slate-800 text-slate-200 border border-white/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 placeholder-slate-600"
                    value={currentTaskType}
                    placeholder="e.g. ticket.translate"
                    onChange={(e) => onUpdateField('taskType', e.target.value)}
                />
            </div>

            {/* 其他 field 展示 */}
            <OtherFieldsDisplay fields={fields} excludeKeys={['agentCode', 'taskType']} />
        </div>
    );
}

// ─── Agent 信息标签 ───

function AgentInfoBadge({ agents, agentCode }: { agents: AgentDefinition[]; agentCode: string }) {
    const agent = agents.find(a => a.code === agentCode);
    if (!agent) {
        return (
            <div className="mt-1 px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-300 rounded inline-block">
                Agent not found: {agentCode}
            </div>
        );
    }
    return (
        <div className="mt-1 space-y-0.5">
            <div className="flex items-center gap-1.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${agent.enabled ? 'bg-green-400' : 'bg-slate-500'}`} />
                <span className="text-[10px] text-slate-400">
                    {agent.providerType} | {agent.executionEnv}
                </span>
            </div>
            {agent.capability && (
                <div className="text-[10px] text-slate-500">
                    Capability: {agent.capability}
                </div>
            )}
        </div>
    );
}

// ─── Callback 配置子面板 ───

interface CallbackConfigPanelProps {
    fields: Record<string, string>;
    onUpdateField: (fieldName: string, fieldValue: string) => void;
}

function CallbackConfigPanel({ fields, onUpdateField }: CallbackConfigPanelProps) {
    const currentCallbackType = fields['callbackType'] || '';

    return (
        <div className="space-y-2">
            <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Callback Config
            </h4>
            <div>
                <label className="text-[10px] text-slate-500 block mb-1">Callback Type</label>
                <input
                    type="text"
                    className="w-full text-xs bg-slate-800 text-slate-200 border border-white/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 placeholder-slate-600"
                    value={currentCallbackType}
                    placeholder="e.g. ticket.onTranslated"
                    onChange={(e) => onUpdateField('callbackType', e.target.value)}
                />
            </div>
            <OtherFieldsDisplay fields={fields} excludeKeys={['callbackType']} />
        </div>
    );
}

// ─── Human Task 配置子面板 ───

interface HumanTaskConfigPanelProps {
    fields: Record<string, string>;
    onUpdateField: (fieldName: string, fieldValue: string) => void;
}

function HumanTaskConfigPanel({ fields, onUpdateField }: HumanTaskConfigPanelProps) {
    const currentTaskType = fields['taskType'] || '';
    const currentAssigneeRole = fields['assigneeRole'] || '';

    return (
        <div className="space-y-2">
            <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Human Task Config
            </h4>
            <div>
                <label className="text-[10px] text-slate-500 block mb-1">Task Type</label>
                <input
                    type="text"
                    className="w-full text-xs bg-slate-800 text-slate-200 border border-white/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 placeholder-slate-600"
                    value={currentTaskType}
                    placeholder="e.g. ticket.audit"
                    onChange={(e) => onUpdateField('taskType', e.target.value)}
                />
            </div>
            <div>
                <label className="text-[10px] text-slate-500 block mb-1">Assignee Role</label>
                <input
                    type="text"
                    className="w-full text-xs bg-slate-800 text-slate-200 border border-white/10 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 placeholder-slate-600"
                    value={currentAssigneeRole}
                    placeholder="e.g. AUDITOR"
                    onChange={(e) => onUpdateField('assigneeRole', e.target.value)}
                />
            </div>
            <OtherFieldsDisplay fields={fields} excludeKeys={['taskType', 'assigneeRole']} />
        </div>
    );
}

// ─── 其他 field 只读展示 ───

function OtherFieldsDisplay({ fields, excludeKeys }: { fields: Record<string, string>; excludeKeys: string[] }) {
    const otherEntries = Object.entries(fields).filter(([k]) => !excludeKeys.includes(k));
    if (otherEntries.length === 0) return null;

    return (
        <div className="mt-2 pt-2 border-t border-white/5">
            <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Other Fields
            </h4>
            <div className="space-y-1">
                {otherEntries.map(([key, value]) => (
                    <div key={key}>
                        <label className="text-[10px] text-slate-600">{key}</label>
                        <div className="text-[11px] text-slate-400 font-mono truncate" title={value}>
                            {value || '(empty)'}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}


// ─── 主组件 ───

const WorkflowListTab: React.FC = () => {
    const { t } = useTranslation('common');
    const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // 编辑器状态
    const [editingDef, setEditingDef] = useState<WorkflowDefinition | null>(null);
    const [bpmnXml, setBpmnXml] = useState('');
    const [xmlLoading, setXmlLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const editorRef = useRef<BpmnEditorHandle>(null);

    // 属性面板状态
    const [selectedElement, setSelectedElement] = useState<SelectedBpmnElement | null>(null);
    const [agents, setAgents] = useState<AgentDefinition[]>([]);
    const [agentsLoading, setAgentsLoading] = useState(false);

    const loadDefinitions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await workflowApi.listDefinitions();
            setDefinitions(data);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadDefinitions(); }, [loadDefinitions]);

    // 进入编辑器时加载 Agent 列表
    const loadAgents = useCallback(async () => {
        setAgentsLoading(true);
        try {
            const data = await agentApi.getAllDefinitions();
            setAgents(data);
        } catch (e) {
            console.error('[WorkflowListTab] Failed to load agents:', e);
        } finally {
            setAgentsLoading(false);
        }
    }, []);

    const handleDeploy = async (id: number) => {
        try {
            await workflowApi.deploy(id);
            setMessage({ type: 'success', text: '部署成功' });
            loadDefinitions();
        } catch (e) {
            setMessage({ type: 'error', text: (e as Error).message });
        }
    };

    const handleEdit = async (def: WorkflowDefinition) => {
        setEditingDef(def);
        setXmlLoading(true);
        setMessage(null);
        setHasChanges(false);
        setSelectedElement(null);
        try {
            const result = await workflowApi.getBpmnXml(def.id);
            setBpmnXml(result.bpmnXml || '');
        } catch (e) {
            setMessage({ type: 'error', text: (e as Error).message });
        } finally {
            setXmlLoading(false);
        }
        // 并行加载 Agent 列表
        loadAgents();
    };

    const handleSave = async () => {
        if (!editingDef || !editorRef.current) return;
        setSaving(true);
        setMessage(null);
        try {
            const xml = await editorRef.current.getXml();
            await workflowApi.saveBpmnXml(editingDef.id, xml);
            setHasChanges(false);
            setMessage({ type: 'success', text: 'BPMN 保存成功' });
        } catch (e) {
            setMessage({ type: 'error', text: (e as Error).message });
        } finally {
            setSaving(false);
        }
    };

    const handleSaveAndDeploy = async () => {
        if (!editingDef || !editorRef.current) return;
        setSaving(true);
        setMessage(null);
        try {
            const xml = await editorRef.current.getXml();
            await workflowApi.saveBpmnXml(editingDef.id, xml);
            await workflowApi.deploy(editingDef.id);
            setHasChanges(false);
            setMessage({ type: 'success', text: '保存并部署成功' });
            loadDefinitions();
        } catch (e) {
            setMessage({ type: 'error', text: (e as Error).message });
        } finally {
            setSaving(false);
        }
    };

    const handleBack = () => {
        setEditingDef(null);
        setBpmnXml('');
        setMessage(null);
        setHasChanges(false);
        setSelectedElement(null);
    };

    const handleElementSelected = useCallback((element: SelectedBpmnElement | null) => {
        setSelectedElement(element);
    }, []);

    const handleFieldChanged = useCallback(() => {
        setHasChanges(true);
    }, []);

    // ── 编辑器视图 ──
    if (editingDef) {
        return (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* 顶栏 */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-slate-900/80 backdrop-blur-sm shrink-0">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleBack}
                            className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-white/10"
                            title="返回列表"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <div>
                            <h2 className="text-sm font-semibold text-white">
                                {editingDef.name}
                            </h2>
                            <span className="text-xs text-slate-400 font-mono">{editingDef.processKey}</span>
                        </div>
                        {hasChanges && (
                            <span className="ml-2 px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-300 rounded">
                                未保存
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {message && (
                            <span className={`text-xs px-2 py-1 rounded ${
                                message.type === 'success'
                                    ? 'bg-green-500/20 text-green-300'
                                    : 'bg-red-500/20 text-red-300'
                            }`}>
                                {message.text}
                            </span>
                        )}
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="px-3 py-1.5 text-xs bg-slate-600 text-white rounded-md hover:bg-slate-500 disabled:opacity-50"
                        >
                            {saving ? '保存中...' : '保存'}
                        </button>
                        <button
                            onClick={handleSaveAndDeploy}
                            disabled={saving}
                            className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-md hover:bg-purple-500 disabled:opacity-50"
                        >
                            {saving ? '部署中...' : '保存并部署'}
                        </button>
                    </div>
                </div>

                {/* 编辑器 + 属性面板 */}
                <div className="flex-1 min-h-0 flex">
                    {/* 左侧 BPMN 编辑器 */}
                    <div className="flex-1 min-w-0 relative">
                        {xmlLoading ? (
                            <div className="flex items-center justify-center h-full">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
                            </div>
                        ) : (
                            <Suspense fallback={
                                <div className="flex items-center justify-center h-full">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
                                </div>
                            }>
                                <BpmnEditor
                                    ref={editorRef}
                                    xml={bpmnXml}
                                    onChanged={() => setHasChanges(true)}
                                    onElementSelected={handleElementSelected}
                                />
                            </Suspense>
                        )}
                    </div>

                    {/* 右侧属性面板 */}
                    <PropertiesPanel
                        selectedElement={selectedElement}
                        editorRef={editorRef}
                        agents={agents}
                        agentsLoading={agentsLoading}
                        onFieldChanged={handleFieldChanged}
                    />
                </div>
            </div>
        );
    }

    // ── 列表视图 ──
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6 overflow-auto flex-1">
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                    {t('nav.workflowList')}
                </h1>
                <button
                    onClick={loadDefinitions}
                    className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700"
                >
                    {t('button.refresh')}
                </button>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {message && (
                <div className={`rounded-lg p-3 text-sm ${
                    message.type === 'success'
                        ? 'bg-green-50 border border-green-200 text-green-700'
                        : 'bg-red-50 border border-red-200 text-red-700'
                }`}>
                    {message.text}
                </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">名称</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">业务类型</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">部署状态</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {definitions.map(def => (
                            <tr key={def.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                                <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-gray-100">
                                    {def.processKey}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                                    {def.name}
                                </td>
                                <td className="px-4 py-3 text-sm">
                                    <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">
                                        {def.businessType}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-sm">
                                    {def.deploymentId ? (
                                        <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800">
                                            已部署
                                        </span>
                                    ) : (
                                        <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800">
                                            未部署
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-sm space-x-3">
                                    <button
                                        onClick={() => handleEdit(def)}
                                        className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                    >
                                        设计
                                    </button>
                                    <button
                                        onClick={() => handleDeploy(def.id)}
                                        className="text-purple-600 hover:text-purple-800 text-xs font-medium"
                                    >
                                        部署
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {definitions.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                                    暂无工作流定义
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default WorkflowListTab;
