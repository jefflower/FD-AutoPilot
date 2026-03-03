import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, RefreshCw, Download, Pencil, Trash2, Check } from 'lucide-react';
import type { KnowledgeBase } from '../../../shared/types/server';

interface KnowledgeBaseSelectorProps {
    bases: KnowledgeBase[];
    activeBase: KnowledgeBase | null;
    onChange: (base: KnowledgeBase) => void;
    onCreate: () => void;
    onEdit: (base: KnowledgeBase) => void;
    onDelete: (base: KnowledgeBase) => void;
    onSyncAll: () => void;
    onPull: () => void;
    syncing: boolean;
    pulling: boolean;
}

const KnowledgeBaseSelector: React.FC<KnowledgeBaseSelectorProps> = ({
    bases, activeBase, onChange, onCreate, onEdit, onDelete,
    onSyncAll, onPull, syncing, pulling,
}) => {
    const { t } = useTranslation('knowledge');
    const [open, setOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div className="px-5 py-3 border-b border-white/10 bg-gradient-to-r from-amber-900/30 to-slate-900/20 flex items-center justify-between">
            {/* Left: Base selector dropdown */}
            <div className="relative" ref={dropdownRef}>
                <button
                    onClick={() => setOpen(!open)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                >
                    {activeBase && activeBase.color && (
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeBase.color }} />
                    )}
                    <span className="text-xs font-bold text-white max-w-[200px] truncate">
                        {activeBase?.name || t('base.empty')}
                    </span>
                    {activeBase && (
                        <span className="text-[10px] text-slate-500 font-mono">
                            ({t('base.sourceCount', { count: activeBase.sourceCount ?? 0 })})
                        </span>
                    )}
                    <ChevronDown size={12} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                    <div className="absolute top-full left-0 mt-1 w-72 bg-slate-800 border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                            {bases.map(base => (
                                <div
                                    key={base.id}
                                    className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-all group ${
                                        activeBase?.id === base.id ? 'bg-amber-500/10' : 'hover:bg-white/5'
                                    }`}
                                    onClick={() => { onChange(base); setOpen(false); }}
                                >
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                        {base.color && (
                                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: base.color }} />
                                        )}
                                        <span className="text-xs text-white truncate">{base.name}</span>
                                        <span className="text-[10px] text-slate-500 font-mono flex-shrink-0">
                                            {base.sourceCount ?? 0}
                                        </span>
                                        {activeBase?.id === base.id && (
                                            <Check size={12} className="text-amber-400 flex-shrink-0" />
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onEdit(base); }}
                                            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                                        >
                                            <Pencil size={10} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onDelete(base); }}
                                            className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                                        >
                                            <Trash2 size={10} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {bases.length === 0 && (
                                <div className="px-3 py-4 text-center text-xs text-slate-500">{t('base.empty')}</div>
                            )}
                        </div>
                        <div className="border-t border-white/10">
                            <button
                                onClick={() => { onCreate(); setOpen(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors"
                            >
                                <Plus size={12} />
                                {t('base.create')}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Right: Action buttons */}
            <div className="flex items-center gap-2">
                <button
                    onClick={onSyncAll}
                    disabled={!activeBase || syncing}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 disabled:opacity-30 text-amber-300 text-[10px] font-bold transition-all"
                >
                    <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
                    {syncing ? t('sync.syncingAll') : t('sync.syncAll')}
                </button>
                <button
                    onClick={onPull}
                    disabled={pulling}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 text-[10px] font-bold transition-all"
                >
                    <Download size={11} className={pulling ? 'animate-bounce' : ''} />
                    {pulling ? t('sync.pulling') : t('sync.pull')}
                </button>
            </div>
        </div>
    );
};

export default KnowledgeBaseSelector;
