/**
 * WorkspacePanel - 工作区管理面板
 *
 * 管理 AI 工作流的工作区文档：Swagger 分组选择、自定义文档编辑、上下文预览。
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { workflowAiApi } from '../../../shared/services/serverApi';
import type { AiWorkflowWorkspaceDoc } from '../../../shared/services/api/workflow';
import { useToast } from '../../../shared/hooks/useToast';
import {
  FileText, Plus, Trash2, Pencil, X,
  Eye, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';

interface WorkspacePanelProps {
  workflowId: number;
}

export default function WorkspacePanel({ workflowId }: WorkspacePanelProps) {
  const { t } = useTranslation('common');
  const { toast } = useToast();

  const [docs, setDocs] = useState<AiWorkflowWorkspaceDoc[]>([]);
  const [swaggerGroups, setSwaggerGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // 自定义文档新增
  const [addingCustom, setAddingCustom] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocContent, setNewDocContent] = useState('');
  const [saving, setSaving] = useState(false);

  // 自定义文档编辑
  const [editingDocId, setEditingDocId] = useState<number | null>(null);
  const [editDocTitle, setEditDocTitle] = useState('');
  const [editDocContent, setEditDocContent] = useState('');

  // 上下文预览
  const [assembledContext, setAssembledContext] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Swagger 文档预览
  const [swaggerPreviewGroup, setSwaggerPreviewGroup] = useState<string | null>(null);
  const [swaggerPreviewContent, setSwaggerPreviewContent] = useState<string | null>(null);
  const [swaggerPreviewing, setSwaggerPreviewing] = useState(false);

  // 节折叠状态
  const [swaggerExpanded, setSwaggerExpanded] = useState(true);
  const [customExpanded, setCustomExpanded] = useState(true);

  // 加载文档列表
  const loadDocs = useCallback(async () => {
    try {
      const result = await workflowAiApi.getWorkspace(workflowId);
      setDocs(result || []);
    } catch (err: any) {
      toast('error', err.message || t('message.loadFailed'));
    }
  }, [workflowId, t, toast]);

  // 加载 Swagger 分组
  const loadSwaggerGroups = useCallback(async () => {
    try {
      const groups = await workflowAiApi.getSwaggerGroups();
      setSwaggerGroups(groups || []);
    } catch (err: any) {
      console.log('Failed to load swagger groups:', err.message);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadDocs(), loadSwaggerGroups()]).finally(() => setLoading(false));
  }, [workflowId, loadDocs, loadSwaggerGroups]);

  // Swagger 文档选择
  const isSwaggerSelected = useCallback(
    (group: string) => docs.some(d => d.docType === 'SWAGGER_GROUP' && d.swaggerGroup === group),
    [docs],
  );

  const toggleSwagger = useCallback(
    async (group: string) => {
      const existing = docs.find(d => d.docType === 'SWAGGER_GROUP' && d.swaggerGroup === group);
      try {
        if (existing) {
          await workflowAiApi.removeWorkspaceDoc(workflowId, existing.id);
        } else {
          await workflowAiApi.addWorkspaceDoc(workflowId, {
            docType: 'SWAGGER_GROUP',
            docTitle: `API: ${group}`,
            swaggerGroup: group,
          });
        }
        await loadDocs();
      } catch (err: any) {
        toast('error', err.message || t('message.operationFailed'));
      }
    },
    [docs, workflowId, loadDocs, t, toast],
  );

  // 自定义文档列表
  const customDocs = docs.filter(d => d.docType === 'CUSTOM');

  // 新增自定义文档
  const addCustomDoc = useCallback(async () => {
    if (!newDocTitle.trim()) return;
    setSaving(true);
    try {
      await workflowAiApi.addWorkspaceDoc(workflowId, {
        docType: 'CUSTOM',
        docTitle: newDocTitle.trim(),
        docContent: newDocContent,
      });
      setNewDocTitle('');
      setNewDocContent('');
      setAddingCustom(false);
      await loadDocs();
      toast('success', t('message.operationSuccess'));
    } catch (err: any) {
      toast('error', err.message || t('message.operationFailed'));
    } finally {
      setSaving(false);
    }
  }, [newDocTitle, newDocContent, workflowId, loadDocs, t, toast]);

  // 删除文档
  const removeDoc = useCallback(
    async (docId: number) => {
      if (!confirm(t('message.confirmDelete'))) return;
      try {
        await workflowAiApi.removeWorkspaceDoc(workflowId, docId);
        await loadDocs();
        toast('success', t('message.operationSuccess'));
      } catch (err: any) {
        toast('error', err.message || t('message.operationFailed'));
      }
    },
    [workflowId, loadDocs, t, toast],
  );

  // 开始编辑自定义文档
  const startEdit = useCallback((doc: AiWorkflowWorkspaceDoc) => {
    setEditingDocId(doc.id);
    setEditDocTitle(doc.docTitle);
    setEditDocContent(doc.docContent || '');
  }, []);

  // 保存编辑（删除旧文档 + 新增）
  const saveEdit = useCallback(async () => {
    if (editingDocId === null || !editDocTitle.trim()) return;
    setSaving(true);
    try {
      await workflowAiApi.removeWorkspaceDoc(workflowId, editingDocId);
      await workflowAiApi.addWorkspaceDoc(workflowId, {
        docType: 'CUSTOM',
        docTitle: editDocTitle.trim(),
        docContent: editDocContent,
      });
      setEditingDocId(null);
      await loadDocs();
      toast('success', t('message.operationSuccess'));
    } catch (err: any) {
      toast('error', err.message || t('message.operationFailed'));
    } finally {
      setSaving(false);
    }
  }, [editingDocId, editDocTitle, editDocContent, workflowId, loadDocs, t, toast]);

  // 取消编辑
  const cancelEdit = useCallback(() => {
    setEditingDocId(null);
    setEditDocTitle('');
    setEditDocContent('');
  }, []);

  // 预览上下文
  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    try {
      const ctx = await workflowAiApi.assembleContext(workflowId);
      setAssembledContext(ctx || '');
      setShowPreview(true);
    } catch (err: any) {
      toast('error', err.message || t('message.operationFailed'));
    } finally {
      setPreviewing(false);
    }
  }, [workflowId, t, toast]);

  // 预览 Swagger 文档
  const handleSwaggerPreview = useCallback(async (group: string) => {
    setSwaggerPreviewing(true);
    setSwaggerPreviewGroup(group);
    try {
      const content = await workflowAiApi.previewSwaggerDoc(group);
      setSwaggerPreviewContent(content || '');
    } catch (err: any) {
      toast('error', err.message || t('message.operationFailed'));
      setSwaggerPreviewGroup(null);
    } finally {
      setSwaggerPreviewing(false);
    }
  }, [t, toast]);

  // Token 估算
  const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ========== Swagger 文档选择器 ========== */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
        <button
          onClick={() => setSwaggerExpanded(v => !v)}
          className="w-full flex items-center justify-between mb-2"
        >
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {t('workflowAi.workspace.swaggerTitle')}
          </h4>
          {swaggerExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          )}
        </button>

        {swaggerExpanded && (
          <div className="space-y-1.5">
            {swaggerGroups.length === 0 ? (
              <p className="text-xs text-slate-500">{t('message.noData')}</p>
            ) : (
              swaggerGroups.map(group => {
                const selected = isSwaggerSelected(group);
                return (
                  <div
                    key={group}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded transition-colors ${
                      selected
                        ? 'bg-blue-500/10 border border-blue-500/30'
                        : 'bg-slate-700/30 border border-transparent hover:bg-slate-700/50'
                    }`}
                  >
                    <label className="flex items-center gap-2 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSwagger(group)}
                        className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                      />
                      <span className="text-xs text-slate-300">{group}</span>
                    </label>
                    <button
                      onClick={() => handleSwaggerPreview(group)}
                      className="p-1 text-slate-500 hover:text-blue-400 transition-colors flex-shrink-0"
                      title={t('workflowAi.workspace.previewSwagger')}
                    >
                      <Eye className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ========== 自定义文档 ========== */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
        <button
          onClick={() => setCustomExpanded(v => !v)}
          className="w-full flex items-center justify-between mb-2"
        >
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('workflowAi.workspace.customTitle')}
          </h4>
          {customExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          )}
        </button>

        {customExpanded && (
          <>
            {/* 已有自定义文档列表 */}
            <div className="space-y-2 mb-2">
              {customDocs.length === 0 && !addingCustom && (
                <p className="text-xs text-slate-500">{t('message.noData')}</p>
              )}
              {customDocs.map(doc => (
                <div
                  key={doc.id}
                  className="bg-slate-700/30 border border-slate-600/30 rounded p-2"
                >
                  {editingDocId === doc.id ? (
                    /* 编辑模式 */
                    <div className="space-y-2">
                      <input
                        value={editDocTitle}
                        onChange={e => setEditDocTitle(e.target.value)}
                        className="w-full bg-slate-700/50 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        placeholder={t('workflowAi.workspace.titlePlaceholder')}
                      />
                      <textarea
                        value={editDocContent}
                        onChange={e => setEditDocContent(e.target.value)}
                        rows={6}
                        className="w-full bg-slate-700/50 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none font-mono"
                        placeholder={t('workflowAi.workspace.contentPlaceholder')}
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={cancelEdit}
                          className="px-2 py-1 text-xs text-slate-400 hover:text-slate-300 transition-colors"
                        >
                          {t('button.cancel')}
                        </button>
                        <button
                          onClick={saveEdit}
                          disabled={!editDocTitle.trim() || saving}
                          className={`px-2.5 py-1 text-xs rounded transition-colors ${
                            editDocTitle.trim() && !saving
                              ? 'bg-blue-600 hover:bg-blue-500 text-white'
                              : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          {saving ? t('button.saving') : t('button.save')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* 展示模式 */
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-300 truncate flex-1 mr-2">
                        {doc.docTitle}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => startEdit(doc)}
                          className="p-1 text-slate-500 hover:text-blue-400 transition-colors"
                          title={t('button.edit')}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => removeDoc(doc.id)}
                          className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                          title={t('button.delete')}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 新增表单 */}
            {addingCustom ? (
              <div className="bg-slate-700/30 border border-slate-600/30 rounded p-2 space-y-2">
                <input
                  value={newDocTitle}
                  onChange={e => setNewDocTitle(e.target.value)}
                  className="w-full bg-slate-700/50 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder={t('workflowAi.workspace.titlePlaceholder')}
                  autoFocus
                />
                <textarea
                  value={newDocContent}
                  onChange={e => setNewDocContent(e.target.value)}
                  rows={6}
                  className="w-full bg-slate-700/50 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none font-mono"
                  placeholder={t('workflowAi.workspace.contentPlaceholder')}
                />
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => {
                      setAddingCustom(false);
                      setNewDocTitle('');
                      setNewDocContent('');
                    }}
                    className="px-2 py-1 text-xs text-slate-400 hover:text-slate-300 transition-colors"
                  >
                    {t('button.cancel')}
                  </button>
                  <button
                    onClick={addCustomDoc}
                    disabled={!newDocTitle.trim() || saving}
                    className={`px-2.5 py-1 text-xs rounded transition-colors ${
                      newDocTitle.trim() && !saving
                        ? 'bg-blue-600 hover:bg-blue-500 text-white'
                        : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    {saving ? t('button.saving') : t('button.save')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingCustom(true)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-slate-400 hover:text-blue-400 border border-dashed border-slate-600/50 hover:border-blue-500/30 rounded transition-colors"
              >
                <Plus className="w-3 h-3" />
                {t('workflowAi.workspace.addDoc')}
              </button>
            )}
          </>
        )}
      </div>

      {/* ========== 预览上下文 ========== */}
      <button
        onClick={handlePreview}
        disabled={previewing}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-slate-300 bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/50 rounded transition-colors disabled:opacity-50"
      >
        {previewing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Eye className="w-3.5 h-3.5" />
        )}
        {t('workflowAi.workspace.previewContext')}
      </button>

      {/* 预览模态框 */}
      {showPreview && assembledContext !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-lg w-[640px] max-h-[70vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between flex-shrink-0">
              <h3 className="text-sm font-medium text-slate-200">
                {t('workflowAi.workspace.previewTitle')}
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">
                  {t('workflowAi.workspace.estimatedTokens', {
                    count: estimateTokens(assembledContext),
                  })}
                </span>
                <button
                  onClick={() => setShowPreview(false)}
                  className="p-1 text-slate-400 hover:text-slate-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* 内容 */}
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words leading-relaxed">
                {assembledContext || t('message.noData')}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Swagger 文档预览弹窗 */}
      {swaggerPreviewGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => { setSwaggerPreviewGroup(null); setSwaggerPreviewContent(null); }}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-lg flex flex-col"
            style={{ width: '75vw', maxHeight: '80vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between flex-shrink-0">
              <h3 className="text-sm font-medium text-slate-200">
                {t('workflowAi.workspace.swaggerPreviewTitle', { group: swaggerPreviewGroup })}
              </h3>
              <div className="flex items-center gap-3">
                {swaggerPreviewContent && (
                  <span className="text-xs text-slate-500">
                    {t('workflowAi.workspace.estimatedTokens', {
                      count: estimateTokens(swaggerPreviewContent),
                    })}
                  </span>
                )}
                <button
                  onClick={() => { setSwaggerPreviewGroup(null); setSwaggerPreviewContent(null); }}
                  className="p-1 text-slate-400 hover:text-slate-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* 内容 */}
            <div className="flex-1 overflow-y-auto p-4">
              {swaggerPreviewing ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
                </div>
              ) : (
                <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {swaggerPreviewContent || t('message.noData')}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
