import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, BookOpen, Loader2 } from 'lucide-react';
import { knowledgeApi } from '../../../shared/services/serverApi';
import type { NotebookInfo } from '../../../shared/types/server';

interface NotebookPickerDialogProps {
    open: boolean;
    onClose: () => void;
    onSelect: (notebook: NotebookInfo) => void;
}

const NotebookPickerDialog: React.FC<NotebookPickerDialogProps> = ({ open, onClose, onSelect }) => {
    const { t } = useTranslation('knowledge');
    const [notebooks, setNotebooks] = useState<NotebookInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        setError(null);
        setNotebooks([]);

        knowledgeApi.listNotebooks()
            .then(data => {
                setNotebooks(data);
            })
            .catch(err => {
                console.error('Failed to load notebooks:', err);
                setError(err.message || t('notebook.loadFailed'));
            })
            .finally(() => {
                setLoading(false);
            });
    }, [open, t]);

    if (!open) return null;

    const content = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-[480px] max-h-[70vh] bg-slate-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between flex-shrink-0">
                    <div>
                        <h3 className="text-sm font-bold text-white">{t('notebook.pickTitle')}</h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">{t('notebook.pickDesc')}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg hover:bg-white/10 text-slate-400 transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
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
                        <div className="p-2">
                            {notebooks.map(nb => (
                                <button
                                    key={nb.id}
                                    onClick={() => onSelect(nb)}
                                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-amber-500/10 transition-all group text-left"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                                        <BookOpen size={14} className="text-amber-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-white truncate group-hover:text-amber-300 transition-colors">
                                            {nb.title}
                                        </p>
                                        <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                                            ID: {nb.id}
                                        </p>
                                    </div>
                                    {nb.isOwner && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-bold flex-shrink-0">
                                            Owner
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-white/10 flex justify-end flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all"
                    >
                        {t('button.cancel', { ns: 'common' })}
                    </button>
                </div>
            </div>
        </div>
    );

    return ReactDOM.createPortal(content, document.body);
};

export default NotebookPickerDialog;
