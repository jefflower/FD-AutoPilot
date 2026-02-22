import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { workflowApi } from '../../../shared/services/serverApi';
import type { WorkflowDefinition } from '../../../shared/types/server';
import type { BpmnEditorHandle } from '../components/BpmnEditor';

const BpmnEditor = lazy(() => import('../components/BpmnEditor'));

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
        try {
            const result = await workflowApi.getBpmnXml(def.id);
            setBpmnXml(result.bpmnXml || '');
        } catch (e) {
            setMessage({ type: 'error', text: (e as Error).message });
        } finally {
            setXmlLoading(false);
        }
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
    };

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

                {/* 编辑器区域 */}
                <div className="flex-1 min-h-0 relative">
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
                            />
                        </Suspense>
                    )}
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
