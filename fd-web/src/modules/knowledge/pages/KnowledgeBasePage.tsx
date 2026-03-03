import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Download } from 'lucide-react';
import { knowledgeApi, notebookLmBridge } from '../../../shared/services/serverApi';
import type { KnowledgeBase, KnowledgeSource, KnowledgeSourceType, NotebookInfo } from '../../../shared/types/server';
import DetailEmptyState from '../../ticket/components/DetailEmptyState';
import KnowledgeBaseSelector from '../components/KnowledgeBaseSelector';
import SourceList from '../components/SourceList';
import SourceDetail from '../components/SourceDetail';
import AddSourceDialog from '../components/AddSourceDialog';
import BaseFormDialog from '../components/BaseFormDialog';
import NotebookPickerDialog from '../components/NotebookPickerDialog';

const KnowledgeBasePage: React.FC = () => {
    const { t } = useTranslation('knowledge');

    // Knowledge bases
    const [bases, setBases] = useState<KnowledgeBase[]>([]);
    const [activeBase, setActiveBase] = useState<KnowledgeBase | null>(null);
    const [loading, setLoading] = useState(true);

    // Sources
    const [sources, setSources] = useState<KnowledgeSource[]>([]);
    const [selectedSource, setSelectedSource] = useState<KnowledgeSource | null>(null);
    const [, setSourcesLoading] = useState(false);

    // Search & filter
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<KnowledgeSourceType | null>(null);

    // Dialogs
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [showBaseForm, setShowBaseForm] = useState(false);
    const [editingBase, setEditingBase] = useState<KnowledgeBase | null>(null);

    // Notebook picker dialog
    const [showNotebookPicker, setShowNotebookPicker] = useState(false);

    // Operation states
    const [syncing, setSyncing] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [syncingSource, setSyncingSource] = useState(false);

    // Load knowledge bases
    const loadBases = useCallback(async () => {
        try {
            const data = await knowledgeApi.listBases();
            setBases(data);
            // Auto-select first if no active base
            if (data.length > 0 && !activeBase) {
                setActiveBase(data[0]);
            } else if (activeBase) {
                // Refresh active base data
                const refreshed = data.find(b => b.id === activeBase.id);
                if (refreshed) setActiveBase(refreshed);
            }
        } catch (err) {
            console.error('Failed to load knowledge bases:', err);
        } finally {
            setLoading(false);
        }
    }, [activeBase]);

    // Load sources for active base
    const loadSources = useCallback(async (baseId: number) => {
        setSourcesLoading(true);
        try {
            const data = await knowledgeApi.listSources(baseId);
            setSources(data);
        } catch (err) {
            console.error('Failed to load sources:', err);
            setSources([]);
        } finally {
            setSourcesLoading(false);
        }
    }, []);

    useEffect(() => {
        loadBases();
    }, []);  // eslint-disable-line react-hooks/exhaustive-deps

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
    }, [activeBase?.id, loadSources]);  // eslint-disable-line react-hooks/exhaustive-deps

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

    // Base CRUD
    const handleCreateBase = async (data: { name: string; description?: string; notebookId?: string; color?: string }) => {
        try {
            const created = await knowledgeApi.createBase(data);
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

    // Source operations
    const handleUploadFile = async (file: File) => {
        if (!activeBase) return;
        setUploading(true);
        try {
            const created = await knowledgeApi.uploadFile(activeBase.id, file);
            setSources(prev => [...prev, created]);
            setShowAddDialog(false);
            loadBases();
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
            setShowAddDialog(false);
            loadBases();
        } catch (err) {
            console.error('Failed to add text source:', err);
        }
    };

    const handleAddUrl = async (data: { title: string; sourceType: 'URL'; url: string }) => {
        if (!activeBase) return;
        try {
            const created = await knowledgeApi.addTextSource(activeBase.id, { ...data, content: undefined });
            setSources(prev => [...prev, created]);
            setShowAddDialog(false);
            loadBases();
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
            loadBases();
        } catch (err) {
            console.error('Failed to delete source:', err);
        }
    };

    const handleUpdateSource = async (source: KnowledgeSource, data: { title?: string; content?: string }) => {
        if (!activeBase) return;
        try {
            const updated = await knowledgeApi.updateSource(activeBase.id, source.id, data);
            setSources(prev => prev.map(s => s.id === updated.id ? updated : s));
            setSelectedSource(updated);
        } catch (err) {
            console.error('Failed to update source:', err);
        }
    };

    // Sync operations
    const handleSyncAll = async () => {
        if (!activeBase) return;
        setSyncing(true);
        try {
            await knowledgeApi.syncAll(activeBase.id);
            if (activeBase) loadSources(activeBase.id);
            loadBases();
        } catch (err) {
            console.error('Sync failed:', err);
        } finally {
            setSyncing(false);
        }
    };

    const handleSyncSource = async (source: KnowledgeSource) => {
        if (!activeBase) return;
        setSyncingSource(true);
        try {
            const updated = await knowledgeApi.syncSource(activeBase.id, source.id);
            setSources(prev => prev.map(s => s.id === updated.id ? updated : s));
            if (selectedSource?.id === updated.id) setSelectedSource(updated);
        } catch (err) {
            console.error('Sync source failed:', err);
        } finally {
            setSyncingSource(false);
        }
    };

    const handlePull = async () => {
        // If activeBase exists and has notebookId, pull directly
        if (activeBase && activeBase.notebookId) {
            setPulling(true);
            try {
                await knowledgeApi.pullFromNotebookLm(activeBase.id);
                if (activeBase) loadSources(activeBase.id);
                loadBases();
            } catch (err) {
                console.error('Pull failed:', err);
            } finally {
                setPulling(false);
            }
            return;
        }
        // Otherwise, open notebook picker dialog
        setShowNotebookPicker(true);
    };

    const handleNotebookSelected = async (notebook: NotebookInfo) => {
        setShowNotebookPicker(false);
        setPulling(true);
        try {
            // Create a new knowledge base with the notebook info
            const created = await knowledgeApi.createBase({
                name: notebook.title,
                notebookId: notebook.id,
            });
            setBases(prev => [...prev, created]);
            setActiveBase(created);

            // Pull sources from NotebookLM
            await knowledgeApi.pullFromNotebookLm(created.id);
            loadSources(created.id);
            loadBases();
        } catch (err) {
            console.error('Import from NotebookLM failed:', err);
        } finally {
            setPulling(false);
        }
    };

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-amber-400" />
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Top: Knowledge base selector */}
            <KnowledgeBaseSelector
                bases={bases}
                activeBase={activeBase}
                onChange={setActiveBase}
                onCreate={() => { setEditingBase(null); setShowBaseForm(true); }}
                onEdit={(base) => { setEditingBase(base); setShowBaseForm(true); }}
                onDelete={handleDeleteBase}
                onSyncAll={handleSyncAll}
                onPull={handlePull}
                syncing={syncing}
                pulling={pulling}
            />

            {/* Main: left-right split */}
            {activeBase ? (
                <div className="flex-1 flex overflow-hidden">
                    {/* Left: source list */}
                    <SourceList
                        sources={filteredSources}
                        selectedId={selectedSource?.id}
                        onSelect={setSelectedSource}
                        onAdd={() => setShowAddDialog(true)}
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        typeFilter={typeFilter}
                        onTypeFilterChange={setTypeFilter}
                    />

                    {/* Right: source detail */}
                    {selectedSource ? (
                        <SourceDetail
                            source={selectedSource}
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
                        <div className="flex items-center gap-3 mt-2">
                            <button
                                onClick={() => { setEditingBase(null); setShowBaseForm(true); }}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 text-xs font-bold transition-all"
                            >
                                <Plus size={14} />
                                {t('emptyState.createBase')}
                            </button>
                            <button
                                onClick={handlePull}
                                disabled={pulling}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 text-xs font-bold transition-all"
                            >
                                <Download size={14} className={pulling ? 'animate-bounce' : ''} />
                                {pulling ? t('notebook.importing') : t('emptyState.importFromNotebook')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Dialogs */}
            <AddSourceDialog
                open={showAddDialog}
                onClose={() => setShowAddDialog(false)}
                onUploadFile={handleUploadFile}
                onAddText={handleAddText}
                onAddUrl={handleAddUrl}
                uploading={uploading}
            />

            <BaseFormDialog
                open={showBaseForm}
                editBase={editingBase}
                onClose={() => { setShowBaseForm(false); setEditingBase(null); }}
                onSubmit={editingBase ? handleUpdateBase : handleCreateBase}
            />

            <NotebookPickerDialog
                open={showNotebookPicker}
                onClose={() => setShowNotebookPicker(false)}
                onSelect={handleNotebookSelected}
            />
        </div>
    );
};

export default KnowledgeBasePage;
