import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Loader2, BookOpen, ChevronRight, Plus, CheckCircle2, XCircle, FolderOpen } from 'lucide-react';
import { knowledgeApi, notebookLmBridge } from '../../../shared/services/serverApi';
import type { KnowledgeGroup, NotebookInfo } from '../../../shared/types/server';

interface ImportFromNotebookDialogProps {
    open: boolean;
    groups: KnowledgeGroup[];
    onClose: () => void;
    onImportComplete: () => void;
}

type ImportStep = 'select' | 'target' | 'importing';

interface ImportProgress {
    current: number;
    total: number;
    currentName: string;
    successes: number;
    failures: number;
    done: boolean;
}

const ImportFromNotebookDialog: React.FC<ImportFromNotebookDialogProps> = ({
    open, groups, onClose, onImportComplete,
}) => {
    const { t } = useTranslation('knowledge');

    // Step state
    const [step, setStep] = useState<ImportStep>('select');

    // Step 1: Notebook selection
    const [notebooks, setNotebooks] = useState<NotebookInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Step 2: Target group
    const [targetGroupId, setTargetGroupId] = useState<number | null>(null);
    const [createNewGroup, setCreateNewGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');

    // Step 3: Progress
    const [progress, setProgress] = useState<ImportProgress>({
        current: 0, total: 0, currentName: '', successes: 0, failures: 0, done: false,
    });

    // Load notebooks when dialog opens
    useEffect(() => {
        if (!open) return;
        setStep('select');
        setSelectedIds(new Set());
        setTargetGroupId(groups.length > 0 ? groups[0].id : null);
        setCreateNewGroup(groups.length === 0);
        setNewGroupName('');
        setLoading(true);
        setError(null);
        setProgress({ current: 0, total: 0, currentName: '', successes: 0, failures: 0, done: false });

        notebookLmBridge.listNotebooks()
            .then(data => setNotebooks(data))
            .catch(err => {
                console.error('Failed to load notebooks:', err);
                setError(err.message || t('notebook.loadFailed'));
            })
            .finally(() => setLoading(false));
    }, [open, t, groups]);

    const toggleNotebook = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selectedIds.size === notebooks.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(notebooks.map(n => n.id)));
        }
    };

    // Import logic
    const doImport = useCallback(async () => {
        const selected = notebooks.filter(n => selectedIds.has(n.id));
        if (selected.length === 0) return;

        setStep('importing');

        // Resolve target group
        let groupId = targetGroupId;
        if (createNewGroup && newGroupName.trim()) {
            try {
                const created = await knowledgeApi.createGroup({ name: newGroupName.trim() });
                groupId = created.id;
            } catch (err) {
                console.error('Failed to create group:', err);
                setProgress(prev => ({ ...prev, done: true, failures: selected.length }));
                return;
            }
        }

        if (!groupId) {
            setProgress(prev => ({ ...prev, done: true, failures: selected.length }));
            return;
        }

        let successes = 0;
        let failures = 0;

        for (let i = 0; i < selected.length; i++) {
            const nb = selected[i];
            setProgress({
                current: i + 1,
                total: selected.length,
                currentName: nb.title,
                successes,
                failures,
                done: false,
            });

            try {
                // 1. Create knowledge base linked to this notebook
                const base = await knowledgeApi.createBase({
                    name: nb.title,
                    notebookId: nb.id,
                    groupId,
                });

                // 2. List remote sources from NotebookLM
                const remoteSources = await notebookLmBridge.listSources(nb.id);

                // 3. Save pulled sources to the base
                if (remoteSources.length > 0) {
                    await knowledgeApi.savePulledSources(
                        base.id,
                        remoteSources.map(s => ({
                            id: s.id,
                            title: s.title,
                            status: s.status,
                            type: s.type,
                        })),
                    );
                }

                successes++;
            } catch (err) {
                console.error(`Failed to import notebook ${nb.title}:`, err);
                failures++;
            }
        }

        setProgress({
            current: selected.length,
            total: selected.length,
            currentName: '',
            successes,
            failures,
            done: true,
        });
    }, [notebooks, selectedIds, targetGroupId, createNewGroup, newGroupName]);

    const handleClose = () => {
        if (progress.done) {
            onImportComplete();
        }
        onClose();
    };

    if (!open) return null;

    const content = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={step !== 'importing' ? handleClose : undefined} />
            <div className="relative w-[540px] max-h-[80vh] bg-slate-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between flex-shrink-0">
                    <div>
                        <h3 className="text-sm font-bold text-white">{t('notebook.pickTitle')}</h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">{t('notebook.pickDesc')}</p>
                    </div>
                    {step !== 'importing' && (
                        <button onClick={handleClose} className="p-1 rounded-lg hover:bg-white/10 text-slate-400 transition-colors">
                            <X size={14} />
                        </button>
                    )}
                </div>

                {/* Step indicators */}
                <div className="px-5 py-2 border-b border-white/10 flex items-center gap-2">
                    {(['select', 'target', 'importing'] as ImportStep[]).map((s, i) => {
                        const labels = [
                            t('notebook.pickTitle'),
                            t('notebook.selectTarget'),
                            t('notebook.importing'),
                        ];
                        const isActive = step === s;
                        const isPast = (['select', 'target', 'importing'] as ImportStep[]).indexOf(step) > i;
                        return (
                            <React.Fragment key={s}>
                                {i > 0 && <ChevronRight size={10} className="text-slate-600" />}
                                <span className={`text-[10px] font-bold ${
                                    isActive ? 'text-amber-400' : isPast ? 'text-slate-400' : 'text-slate-600'
                                }`}>
                                    {i + 1}. {labels[i]}
                                </span>
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {/* Step 1: Select notebooks */}
                    {step === 'select' && (
                        <>
                            {loading && (
                                <div className="flex flex-col items-center justify-center py-12 gap-3">
                                    <Loader2 size={24} className="animate-spin text-amber-400" />
                                    <p className="text-xs text-slate-500">{t('notebook.loadingList')}</p>
                                </div>
                            )}

                            {error && (
                                <div className="flex flex-col items-center justify-center py-12 gap-2">
                                    <p className="text-xs text-red-400">{error}</p>
                                </div>
                            )}

                            {!loading && !error && notebooks.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-12 gap-2">
                                    <BookOpen size={24} className="text-slate-600" />
                                    <p className="text-xs text-slate-500">{t('notebook.empty')}</p>
                                </div>
                            )}

                            {!loading && !error && notebooks.length > 0 && (
                                <div className="p-3">
                                    {/* Select all header */}
                                    <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.size === notebooks.length && notebooks.length > 0}
                                            onChange={toggleAll}
                                            className="w-3.5 h-3.5 rounded border-slate-600 bg-white/5 text-amber-500 focus:ring-amber-500/30 focus:ring-offset-0 cursor-pointer"
                                        />
                                        <span className="text-[10px] text-slate-500 font-bold">
                                            {selectedIds.size > 0
                                                ? t('notebook.selectedCount', { count: selectedIds.size })
                                                : t('group.allGroups')}
                                        </span>
                                    </div>

                                    {/* Notebook list */}
                                    {notebooks.map(nb => (
                                        <div
                                            key={nb.id}
                                            onClick={() => toggleNotebook(nb.id)}
                                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                                                selectedIds.has(nb.id) ? 'bg-amber-500/10' : 'hover:bg-white/5'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(nb.id)}
                                                onChange={() => toggleNotebook(nb.id)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-3.5 h-3.5 rounded border-slate-600 bg-white/5 text-amber-500 focus:ring-amber-500/30 focus:ring-offset-0 cursor-pointer"
                                            />
                                            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                                                <BookOpen size={14} className="text-amber-400" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-bold text-white truncate">{nb.title}</p>
                                                <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">ID: {nb.id}</p>
                                            </div>
                                            {nb.isOwner && (
                                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-bold flex-shrink-0">
                                                    Owner
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* Step 2: Select target group */}
                    {step === 'target' && (
                        <div className="p-4 space-y-3">
                            <p className="text-xs text-slate-400 mb-3">
                                {t('notebook.selectTarget')}
                            </p>

                            {/* Existing groups */}
                            {groups.map(group => (
                                <label
                                    key={group.id}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${
                                        !createNewGroup && targetGroupId === group.id
                                            ? 'bg-amber-500/10 border-amber-500/30'
                                            : 'border-transparent hover:bg-white/5'
                                    }`}
                                    onClick={() => {
                                        setCreateNewGroup(false);
                                        setTargetGroupId(group.id);
                                    }}
                                >
                                    <input
                                        type="radio"
                                        name="targetGroup"
                                        checked={!createNewGroup && targetGroupId === group.id}
                                        onChange={() => {
                                            setCreateNewGroup(false);
                                            setTargetGroupId(group.id);
                                        }}
                                        className="w-3.5 h-3.5 text-amber-500 focus:ring-amber-500/30 focus:ring-offset-0 cursor-pointer"
                                    />
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                        {group.color ? (
                                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                                        ) : (
                                            <FolderOpen size={12} className="text-slate-500 flex-shrink-0" />
                                        )}
                                        <span className="text-xs text-white truncate">{group.name}</span>
                                    </div>
                                </label>
                            ))}

                            {/* Create new group option */}
                            <label
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${
                                    createNewGroup
                                        ? 'bg-amber-500/10 border-amber-500/30'
                                        : 'border-transparent hover:bg-white/5'
                                }`}
                                onClick={() => setCreateNewGroup(true)}
                            >
                                <input
                                    type="radio"
                                    name="targetGroup"
                                    checked={createNewGroup}
                                    onChange={() => setCreateNewGroup(true)}
                                    className="w-3.5 h-3.5 text-amber-500 focus:ring-amber-500/30 focus:ring-offset-0 cursor-pointer"
                                />
                                <Plus size={12} className="text-amber-400 flex-shrink-0" />
                                <span className="text-xs text-amber-400 font-bold">{t('notebook.createNewGroup')}</span>
                            </label>

                            {createNewGroup && (
                                <div className="pl-8">
                                    <input
                                        value={newGroupName}
                                        onChange={(e) => setNewGroupName(e.target.value)}
                                        placeholder={t('group.namePlaceholder')}
                                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/30 transition-colors"
                                        autoFocus
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 3: Import progress */}
                    {step === 'importing' && (
                        <div className="p-6 flex flex-col items-center justify-center min-h-[200px] gap-4">
                            {!progress.done ? (
                                <>
                                    <Loader2 size={28} className="animate-spin text-amber-400" />
                                    <p className="text-xs text-slate-300">
                                        {t('notebook.importProgress', {
                                            current: progress.current,
                                            total: progress.total,
                                            name: progress.currentName,
                                        })}
                                    </p>
                                    {/* Progress bar */}
                                    <div className="w-full max-w-xs h-1.5 bg-white/5 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-amber-500 rounded-full transition-all duration-300"
                                            style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    {progress.failures === 0 ? (
                                        <CheckCircle2 size={32} className="text-green-400" />
                                    ) : progress.successes === 0 ? (
                                        <XCircle size={32} className="text-red-400" />
                                    ) : (
                                        <CheckCircle2 size={32} className="text-amber-400" />
                                    )}
                                    <p className="text-xs text-slate-300">
                                        {t('notebook.importComplete', {
                                            success: progress.successes,
                                            failed: progress.failures,
                                        })}
                                    </p>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between flex-shrink-0">
                    {/* Left: selected count (step 1 only) */}
                    <div>
                        {step === 'select' && selectedIds.size > 0 && (
                            <span className="text-[10px] text-amber-400 font-bold">
                                {t('notebook.selectedCount', { count: selectedIds.size })}
                            </span>
                        )}
                    </div>

                    {/* Right: action buttons */}
                    <div className="flex items-center gap-2">
                        {step === 'select' && (
                            <>
                                <button
                                    onClick={handleClose}
                                    className="px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all"
                                >
                                    {t('button.cancel', { ns: 'common' })}
                                </button>
                                <button
                                    onClick={() => setStep('target')}
                                    disabled={selectedIds.size === 0}
                                    className="px-4 py-1.5 rounded-lg bg-amber-600/40 hover:bg-amber-600/60 disabled:opacity-30 text-amber-300 text-xs font-bold transition-all flex items-center gap-1"
                                >
                                    <span>{t('button.next', { ns: 'common', defaultValue: 'Next' })}</span>
                                    <ChevronRight size={12} />
                                </button>
                            </>
                        )}

                        {step === 'target' && (
                            <>
                                <button
                                    onClick={() => setStep('select')}
                                    className="px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all"
                                >
                                    {t('button.back', { ns: 'common', defaultValue: 'Back' })}
                                </button>
                                <button
                                    onClick={doImport}
                                    disabled={createNewGroup ? !newGroupName.trim() : !targetGroupId}
                                    className="px-4 py-1.5 rounded-lg bg-amber-600/40 hover:bg-amber-600/60 disabled:opacity-30 text-amber-300 text-xs font-bold transition-all"
                                >
                                    {t('notebook.importing')}
                                </button>
                            </>
                        )}

                        {step === 'importing' && progress.done && (
                            <button
                                onClick={handleClose}
                                className="px-4 py-1.5 rounded-lg bg-amber-600/40 hover:bg-amber-600/60 text-amber-300 text-xs font-bold transition-all"
                            >
                                {t('button.confirm', { ns: 'common' })}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    return ReactDOM.createPortal(content, document.body);
};

export default ImportFromNotebookDialog;
