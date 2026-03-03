import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Plus, RefreshCw } from 'lucide-react';
import { knowledgeApi, notebookLmBridge } from '../../../shared/services/serverApi';
import type {
    KnowledgeGroup,
    KnowledgeBase,
    KnowledgeSource,
    KnowledgeSourceType,
} from '../../../shared/types/server';
import DetailEmptyState from '../../ticket/components/DetailEmptyState';
import GroupPanel from '../components/GroupPanel';
import BaseTabBar from '../components/BaseTabBar';
import SourceList from '../components/SourceList';
import SourceDetail from '../components/SourceDetail';
import AddSourceDialog from '../components/AddSourceDialog';
import BaseFormDialog from '../components/BaseFormDialog';
import GroupFormDialog from '../components/GroupFormDialog';
import ImportFromNotebookDialog from '../components/ImportFromNotebookDialog';

const NotebookLmPage: React.FC = () => {
    const { t } = useTranslation('knowledge');

    // ---- 主体 (Group) ----
    const [groups, setGroups] = useState<KnowledgeGroup[]>([]);
    const [activeGroup, setActiveGroup] = useState<KnowledgeGroup | null>(null);
    const [loading, setLoading] = useState(true);

    // ---- 知识库 (Base) ----
    const [bases, setBases] = useState<KnowledgeBase[]>([]);
    const [activeBase, setActiveBase] = useState<KnowledgeBase | null>(null);

    // ---- 源 (Source) ----
    const [sources, setSources] = useState<KnowledgeSource[]>([]);
    const [selectedSource, setSelectedSource] = useState<KnowledgeSource | null>(null);

    // ---- Search & filter ----
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<KnowledgeSourceType | null>(null);

    // ---- Dialogs ----
    const [showImportDialog, setShowImportDialog] = useState(false);
    const [showGroupForm, setShowGroupForm] = useState(false);
    const [editingGroup, setEditingGroup] = useState<KnowledgeGroup | null>(null);
    const [showBaseForm, setShowBaseForm] = useState(false);
    const [editingBase, setEditingBase] = useState<KnowledgeBase | null>(null);
    const [showAddSource, setShowAddSource] = useState(false);

    // ---- Operation states ----
    const [syncing, setSyncing] = useState(false);
    const [syncingSource, setSyncingSource] = useState(false);
    const [uploading, setUploading] = useState(false);

    // ======================================================================
    // Data loading chain
    // ======================================================================

    /** Load all groups and auto-select first */
    const loadGroups = useCallback(async () => {
        try {
            const data = await knowledgeApi.listGroups();
            setGroups(data);
            // Auto-select first group if nothing selected, or refresh active
            if (data.length > 0) {
                setActiveGroup(prev => {
                    if (!prev) return data[0];
                    const refreshed = data.find(g => g.id === prev.id);
                    return refreshed || data[0];
                });
            } else {
                setActiveGroup(null);
            }
        } catch (err) {
            console.error('Failed to load groups:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    /** Load bases for the active group */
    const loadBases = useCallback(async (groupId: number) => {
        try {
            const data = await knowledgeApi.listBases(groupId);
            setBases(data);
            // Auto-select first base
            if (data.length > 0) {
                setActiveBase(prev => {
                    if (!prev) return data[0];
                    const refreshed = data.find(b => b.id === prev.id);
                    return refreshed || data[0];
                });
            } else {
                setActiveBase(null);
            }
        } catch (err) {
            console.error('Failed to load bases:', err);
            setBases([]);
            setActiveBase(null);
        }
    }, []);

    /** Load sources for the active base */
    const loadSources = useCallback(async (baseId: number) => {
        try {
            const data = await knowledgeApi.listSources(baseId);
            setSources(data);
        } catch (err) {
            console.error('Failed to load sources:', err);
            setSources([]);
        }
    }, []);

    // Initial load
    useEffect(() => {
        loadGroups();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // When active group changes -> load bases
    useEffect(() => {
        if (activeGroup) {
            loadBases(activeGroup.id);
            setSelectedSource(null);
            setSearchQuery('');
            setTypeFilter(null);
        } else {
            setBases([]);
            setActiveBase(null);
        }
    }, [activeGroup?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // When active base changes -> load sources
    useEffect(() => {
        if (activeBase) {
            loadSources(activeBase.id);
            setSelectedSource(null);
            setSearchQuery('');
            setTypeFilter(null);
        } else {
            setSources([]);
            setSelectedSource(null);
        }
    }, [activeBase?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Filtered sources
    const filteredSources = useMemo(() => {
        let result = sources;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(s =>
                s.title.toLowerCase().includes(q) ||
                s.originalFileName?.toLowerCase().includes(q) ||
                s.url?.toLowerCase().includes(q)
            );
        }
        if (typeFilter) {
            result = result.filter(s => s.sourceType === typeFilter);
        }
        return result;
    }, [sources, searchQuery, typeFilter]);

    // ======================================================================
    // Group CRUD
    // ======================================================================

    const handleCreateGroup = async (data: { name: string; description?: string; color?: string }) => {
        try {
            const created = await knowledgeApi.createGroup(data);
            setGroups(prev => [...prev, created]);
            setActiveGroup(created);
            setShowGroupForm(false);
        } catch (err) {
            console.error('Failed to create group:', err);
        }
    };

    const handleUpdateGroup = async (data: { name: string; description?: string; color?: string }) => {
        if (!editingGroup) return;
        try {
            const updated = await knowledgeApi.updateGroup(editingGroup.id, data);
            setGroups(prev => prev.map(g => g.id === updated.id ? updated : g));
            if (activeGroup?.id === updated.id) setActiveGroup(updated);
            setShowGroupForm(false);
            setEditingGroup(null);
        } catch (err) {
            console.error('Failed to update group:', err);
        }
    };

    const handleDeleteGroup = async (group: KnowledgeGroup) => {
        if (!confirm(t('group.deleteConfirm', { name: group.name }))) return;
        try {
            await knowledgeApi.deleteGroup(group.id);
            setGroups(prev => prev.filter(g => g.id !== group.id));
            if (activeGroup?.id === group.id) {
                const remaining = groups.filter(g => g.id !== group.id);
                setActiveGroup(remaining.length > 0 ? remaining[0] : null);
            }
        } catch (err) {
            console.error('Failed to delete group:', err);
        }
    };

    // ======================================================================
    // Base CRUD
    // ======================================================================

    const handleCreateBase = async (data: { name: string; description?: string; notebookId?: string; color?: string }) => {
        if (!activeGroup) return;
        try {
            const created = await knowledgeApi.createBase({ ...data, groupId: activeGroup.id });
            setBases(prev => [...prev, created]);
            setActiveBase(created);
            setShowBaseForm(false);
        } catch (err) {
            console.error('Failed to create base:', err);
        }
    };

    const handleUpdateBase = async (data: { name: string; description?: string; notebookId?: string; color?: string }) => {
        if (!editingBase) return;
        try {
            const updated = await knowledgeApi.updateBase(editingBase.id, data);
            setBases(prev => prev.map(b => b.id === updated.id ? updated : b));
            if (activeBase?.id === updated.id) setActiveBase(updated);
            setShowBaseForm(false);
            setEditingBase(null);
        } catch (err) {
            console.error('Failed to update base:', err);
        }
    };

    const handleDeleteBase = async (base: KnowledgeBase) => {
        if (!confirm(t('base.deleteConfirm', { name: base.name }))) return;
        try {
            await knowledgeApi.deleteBase(base.id);
            setBases(prev => prev.filter(b => b.id !== base.id));
            if (activeBase?.id === base.id) {
                const remaining = bases.filter(b => b.id !== base.id);
                setActiveBase(remaining.length > 0 ? remaining[0] : null);
            }
        } catch (err) {
            console.error('Failed to delete base:', err);
        }
    };

    // ======================================================================
    // Source operations
    // ======================================================================

    const handleUploadFile = async (file: File) => {
        if (!activeBase) return;
        setUploading(true);
        try {
            const created = await knowledgeApi.uploadFile(activeBase.id, file);
            setSources(prev => [...prev, created]);
            setShowAddSource(false);
            if (activeGroup) loadBases(activeGroup.id);
        } catch (err) {
            console.error('Failed to upload file:', err);
        } finally {
            setUploading(false);
        }
    };

    const handleAddText = async (data: { title: string; sourceType: 'TEXT' | 'MARKDOWN'; content: string }) => {
        if (!activeBase) return;
        try {
            const created = await knowledgeApi.addTextSource(activeBase.id, data);
            setSources(prev => [...prev, created]);
            setShowAddSource(false);
            if (activeGroup) loadBases(activeGroup.id);
        } catch (err) {
            console.error('Failed to add text source:', err);
        }
    };

    const handleAddUrl = async (data: { title: string; sourceType: 'URL'; url: string }) => {
        if (!activeBase) return;
        try {
            const created = await knowledgeApi.addTextSource(activeBase.id, { ...data, content: undefined });
            setSources(prev => [...prev, created]);
            setShowAddSource(false);
            if (activeGroup) loadBases(activeGroup.id);
        } catch (err) {
            console.error('Failed to add URL source:', err);
        }
    };

    const handleDeleteSource = async (source: KnowledgeSource) => {
        if (!activeBase) return;
        const willDeleteCloud = !!(source.notebookSourceId && activeBase.notebookId);
        const confirmMsg = willDeleteCloud
            ? t('source.deleteConfirmWithCloud', {
                title: source.title,
                defaultValue: '⚠️ 确定删除源 "{{title}}"？\n\n此操作将同时删除 NotebookLM 云端对应的数据，且不可恢复。',
            })
            : t('source.deleteConfirm', { title: source.title });
        if (!confirm(confirmMsg)) return;
        try {
            // 如果源已同步到 NotebookLM，先删除云端源
            if (willDeleteCloud) {
                try {
                    await notebookLmBridge.deleteSource(activeBase.notebookId!, source.notebookSourceId!);
                } catch (err) {
                    console.warn('Failed to delete NotebookLM source (may already be gone):', err);
                }
            }
            await knowledgeApi.deleteSource(activeBase.id, source.id);
            setSources(prev => prev.filter(s => s.id !== source.id));
            if (selectedSource?.id === source.id) setSelectedSource(null);
            if (activeGroup) loadBases(activeGroup.id);
        } catch (err) {
            console.error('Failed to delete source:', err);
        }
    };

    const handleUpdateSource = async (source: KnowledgeSource, data: { title?: string; content?: string; preserveSyncStatus?: boolean }) => {
        if (!activeBase) return;
        try {
            const updated = await knowledgeApi.updateSource(activeBase.id, source.id, data);
            setSources(prev => prev.map(s => s.id === updated.id ? updated : s));
            setSelectedSource(updated);
        } catch (err) {
            console.error('Failed to update source:', err);
        }
    };

    // ======================================================================
    // Sync operations
    // ======================================================================

    /**
     * 同步单个源到 NotebookLM（前端编排 Bridge + Backend）
     * 流程：
     * 1. 如果已有 notebookSourceId → 先删除旧源再重新添加（NotebookLM 不支持编辑）
     * 2. 如果没有 notebookSourceId → 直接添加
     * 3. 成功后更新后端同步状态为 SYNCED
     * 4. 失败则标记为 FAILED
     */
    const handleSyncSource = async (source: KnowledgeSource) => {
        if (!activeBase) return;
        const notebookId = activeBase.notebookId;

        setSyncingSource(true);
        try {
            if (!notebookId) {
                // 没有关联 NotebookLM，直接标记为 SYNCED
                const updated = await knowledgeApi.updateSyncStatus(activeBase.id, source.id, {
                    status: 'SYNCED',
                });
                setSources(prev => prev.map(s => s.id === updated.id ? updated : s));
                if (selectedSource?.id === updated.id) setSelectedSource(updated);
                return;
            }

            // 有 NotebookLM 关联 → 通过 Bridge 推送
            const oldNotebookSourceId = source.notebookSourceId;

            // 先添加新源到 NotebookLM（先加后删，避免添加失败时旧源已被删除导致数据丢失）
            const contentToSync = source.content || source.title;
            const remoteSource = await notebookLmBridge.addSource(
                notebookId,
                contentToSync,
                source.sourceType.toLowerCase(),
                source.title,
            );
            const newNotebookSourceId = remoteSource.id;

            // 添加成功后，再删除旧源（NotebookLM 不支持编辑，需要删旧加新）
            if (oldNotebookSourceId && oldNotebookSourceId !== newNotebookSourceId) {
                try {
                    await notebookLmBridge.deleteSource(notebookId, oldNotebookSourceId);
                } catch (err) {
                    console.warn('Delete old source failed (may already be gone):', err);
                }
            }

            // 更新后端同步状态
            const updated = await knowledgeApi.updateSyncStatus(activeBase.id, source.id, {
                notebookSourceId: newNotebookSourceId,
                status: 'SYNCED',
            });
            setSources(prev => prev.map(s => s.id === updated.id ? updated : s));
            if (selectedSource?.id === updated.id) setSelectedSource(updated);
        } catch (err) {
            console.error('Sync source failed:', err);
            // 标记为 FAILED
            try {
                const failed = await knowledgeApi.updateSyncStatus(activeBase.id, source.id, {
                    status: 'FAILED',
                });
                setSources(prev => prev.map(s => s.id === failed.id ? failed : s));
                if (selectedSource?.id === failed.id) setSelectedSource(failed);
            } catch (e2) {
                console.error('Failed to update sync status:', e2);
            }
        } finally {
            setSyncingSource(false);
        }
    };

    const handleSyncAll = async () => {
        if (!activeBase) return;
        setSyncing(true);
        try {
            // 逐个同步所有源
            for (const source of sources) {
                if (source.syncStatus === 'SYNCING') continue; // 跳过正在同步的
                await handleSyncSource(source);
            }
            // 刷新数据
            if (activeBase) loadSources(activeBase.id);
            if (activeGroup) loadBases(activeGroup.id);
        } catch (err) {
            console.error('Sync all failed:', err);
        } finally {
            setSyncing(false);
        }
    };

    // ======================================================================
    // Import complete callback
    // ======================================================================

    const handleImportComplete = () => {
        loadGroups();
        // 也刷新当前 group 的知识库列表（因为 activeGroup.id 可能没变，useEffect 不会重新触发）
        if (activeGroup) {
            loadBases(activeGroup.id);
        }
    };

    // ======================================================================
    // Render
    // ======================================================================

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-amber-400" />
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Top header bar */}
            <div className="px-5 py-3 border-b border-white/10 bg-gradient-to-r from-amber-900/30 to-slate-900/20 flex items-center justify-between flex-shrink-0">
                <div>
                    <h2 className="text-sm font-bold text-white">NotebookLM</h2>
                    <p className="text-[10px] text-slate-500 mt-0.5">{t('desc')}</p>
                </div>
                <div className="flex items-center gap-2">
                    {activeBase && (
                        <button
                            onClick={handleSyncAll}
                            disabled={syncing}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 disabled:opacity-30 text-amber-300 text-[10px] font-bold transition-all"
                        >
                            <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
                            {syncing ? t('sync.syncingAll') : t('sync.syncAll')}
                        </button>
                    )}
                    <button
                        onClick={() => setShowImportDialog(true)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-bold transition-all"
                    >
                        <Download size={11} />
                        {t('emptyState.importFromNotebook')}
                    </button>
                </div>
            </div>

            {/* Main content: left panel + right area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: Group panel */}
                <GroupPanel
                    groups={groups}
                    activeGroup={activeGroup}
                    onSelect={setActiveGroup}
                    onCreate={() => { setEditingGroup(null); setShowGroupForm(true); }}
                    onEdit={(group) => { setEditingGroup(group); setShowGroupForm(true); }}
                    onDelete={handleDeleteGroup}
                />

                {/* Right: Base tabs + Sources */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {activeGroup ? (
                        <>
                            {/* Base tab bar */}
                            <BaseTabBar
                                bases={bases}
                                activeBase={activeBase}
                                onSelect={setActiveBase}
                                onCreate={() => { setEditingBase(null); setShowBaseForm(true); }}
                                onEdit={(base) => { setEditingBase(base); setShowBaseForm(true); }}
                                onDelete={handleDeleteBase}
                            />

                            {/* Sources area */}
                            {activeBase ? (
                                <div className="flex-1 flex overflow-hidden">
                                    {/* Source list */}
                                    <SourceList
                                        sources={filteredSources}
                                        selectedId={selectedSource?.id}
                                        onSelect={setSelectedSource}
                                        onAdd={() => setShowAddSource(true)}
                                        searchQuery={searchQuery}
                                        onSearchChange={setSearchQuery}
                                        typeFilter={typeFilter}
                                        onTypeFilterChange={setTypeFilter}
                                    />

                                    {/* Source detail */}
                                    {selectedSource ? (
                                        <SourceDetail
                                            source={selectedSource}
                                            notebookId={activeBase?.notebookId}
                                            onSync={handleSyncSource}
                                            onDelete={handleDeleteSource}
                                            onUpdate={handleUpdateSource}
                                            syncing={syncingSource}
                                        />
                                    ) : (
                                        <div className="flex-1 bg-slate-900/40">
                                            <DetailEmptyState
                                                title={t('source.empty')}
                                                subtitle={t('source.emptyHint')}
                                            />
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex-1 bg-slate-900/40">
                                    <div className="h-full flex flex-col items-center justify-center gap-4">
                                        <DetailEmptyState
                                            title={t('base.empty')}
                                            subtitle={t('base.emptyHint')}
                                        />
                                        <button
                                            onClick={() => { setEditingBase(null); setShowBaseForm(true); }}
                                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 text-xs font-bold transition-all"
                                        >
                                            <Plus size={14} />
                                            {t('emptyState.createBase')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex-1 bg-slate-900/40">
                            <div className="h-full flex flex-col items-center justify-center gap-4">
                                <DetailEmptyState
                                    title={t('group.empty')}
                                    subtitle={t('group.emptyHint')}
                                />
                                <div className="flex items-center gap-3 mt-2">
                                    <button
                                        onClick={() => { setEditingGroup(null); setShowGroupForm(true); }}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 text-xs font-bold transition-all"
                                    >
                                        <Plus size={14} />
                                        {t('group.create')}
                                    </button>
                                    <button
                                        onClick={() => setShowImportDialog(true)}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all"
                                    >
                                        <Download size={14} />
                                        {t('emptyState.importFromNotebook')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ---- Dialogs ---- */}

            <GroupFormDialog
                open={showGroupForm}
                editGroup={editingGroup}
                onClose={() => { setShowGroupForm(false); setEditingGroup(null); }}
                onSubmit={editingGroup ? handleUpdateGroup : handleCreateGroup}
            />

            <BaseFormDialog
                open={showBaseForm}
                editBase={editingBase}
                onClose={() => { setShowBaseForm(false); setEditingBase(null); }}
                onSubmit={editingBase ? handleUpdateBase : handleCreateBase}
            />

            <AddSourceDialog
                open={showAddSource}
                onClose={() => setShowAddSource(false)}
                onUploadFile={handleUploadFile}
                onAddText={handleAddText}
                onAddUrl={handleAddUrl}
                uploading={uploading}
            />

            <ImportFromNotebookDialog
                open={showImportDialog}
                groups={groups}
                onClose={() => setShowImportDialog(false)}
                onImportComplete={handleImportComplete}
            />
        </div>
    );
};

export default NotebookLmPage;
