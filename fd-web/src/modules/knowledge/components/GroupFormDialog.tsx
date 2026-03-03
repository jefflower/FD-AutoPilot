import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { KnowledgeGroup } from '../../../shared/types/server';

const COLOR_OPTIONS = [
    '#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6',
    '#ec4899', '#f97316', '#14b8a6', '#6366f1', '#64748b',
];

interface GroupFormDialogProps {
    open: boolean;
    editGroup: KnowledgeGroup | null;
    onClose: () => void;
    onSubmit: (data: { name: string; description?: string; color?: string }) => void;
}

const GroupFormDialog: React.FC<GroupFormDialogProps> = ({ open, editGroup, onClose, onSubmit }) => {
    const { t } = useTranslation('knowledge');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [color, setColor] = useState(COLOR_OPTIONS[0]);

    useEffect(() => {
        if (editGroup) {
            setName(editGroup.name);
            setDescription(editGroup.description || '');
            setColor(editGroup.color || COLOR_OPTIONS[0]);
        } else {
            setName('');
            setDescription('');
            setColor(COLOR_OPTIONS[0]);
        }
    }, [editGroup, open]);

    if (!open) return null;

    const handleSubmit = () => {
        if (!name.trim()) return;
        onSubmit({
            name: name.trim(),
            description: description.trim() || undefined,
            color,
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && name.trim()) {
            handleSubmit();
        }
    };

    const content = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-[440px] bg-slate-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">
                        {editGroup ? t('group.edit') : t('group.create')}
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-slate-400 transition-colors">
                        <X size={14} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                    <div>
                        <label className="text-[10px] text-slate-500 block mb-1">{t('group.name')} *</label>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('group.namePlaceholder')}
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/30 transition-colors"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-500 block mb-1">{t('group.description')}</label>
                        <input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('group.descriptionPlaceholder')}
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/30 transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-500 block mb-1.5">Color</label>
                        <div className="flex gap-2 flex-wrap">
                            {COLOR_OPTIONS.map(c => (
                                <button
                                    key={c}
                                    onClick={() => setColor(c)}
                                    className={`w-6 h-6 rounded-full border-2 transition-all ${
                                        color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'
                                    }`}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-white/10 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all"
                    >
                        {t('button.cancel', { ns: 'common' })}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!name.trim()}
                        className="px-4 py-1.5 rounded-lg bg-amber-600/40 hover:bg-amber-600/60 disabled:opacity-30 text-amber-300 text-xs font-bold transition-all"
                    >
                        {t('button.confirm', { ns: 'common' })}
                    </button>
                </div>
            </div>
        </div>
    );

    return ReactDOM.createPortal(content, document.body);
};

export default GroupFormDialog;
