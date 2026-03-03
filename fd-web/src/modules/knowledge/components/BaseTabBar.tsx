import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { KnowledgeBase } from '../../../shared/types/server';

interface BaseTabBarProps {
    bases: KnowledgeBase[];
    activeBase: KnowledgeBase | null;
    onSelect: (base: KnowledgeBase) => void;
    onCreate: () => void;
    onEdit: (base: KnowledgeBase) => void;
    onDelete: (base: KnowledgeBase) => void;
}

const BaseTabBar: React.FC<BaseTabBarProps> = ({
    bases, activeBase, onSelect, onCreate, onEdit, onDelete,
}) => {
    const { t } = useTranslation('knowledge');
    const [hoveredId, setHoveredId] = useState<number | null>(null);

    return (
        <div className="px-4 py-2 border-b border-white/10 bg-slate-900/20">
            <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar pb-0.5">
                {bases.map(base => {
                    const isActive = activeBase?.id === base.id;
                    const isHovered = hoveredId === base.id;

                    return (
                        <div
                            key={base.id}
                            onClick={() => onSelect(base)}
                            onMouseEnter={() => setHoveredId(base.id)}
                            onMouseLeave={() => setHoveredId(null)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all flex-shrink-0 border group relative ${
                                isActive
                                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                                    : 'bg-white/5 border-transparent text-slate-300 hover:bg-white/10 hover:text-white'
                            }`}
                        >
                            {/* Color dot */}
                            {base.color && (
                                <span
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: base.color }}
                                />
                            )}

                            {/* Name */}
                            <span className={`text-xs font-medium max-w-[140px] truncate ${
                                isActive ? 'font-bold' : ''
                            }`}>
                                {base.name}
                            </span>

                            {/* Source count badge */}
                            <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                                isActive
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : 'bg-white/5 text-slate-500'
                            }`}>
                                {base.sourceCount ?? 0}
                            </span>

                            {/* Hover edit/delete buttons */}
                            {isHovered && (
                                <div className="flex items-center gap-0.5 ml-0.5 flex-shrink-0">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onEdit(base); }}
                                        className="p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                                    >
                                        <Pencil size={9} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onDelete(base); }}
                                        className="p-0.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                                    >
                                        <Trash2 size={9} />
                                    </button>
                                </div>
                            )}

                            {/* Active bottom indicator */}
                            {isActive && (
                                <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-amber-500 rounded-t" />
                            )}
                        </div>
                    );
                })}

                {/* New tab button */}
                <button
                    onClick={onCreate}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-amber-300 text-xs transition-all flex-shrink-0 border border-dashed border-white/10 hover:border-amber-500/20"
                >
                    <Plus size={11} />
                    <span className="text-[10px] font-bold">{t('base.create')}</span>
                </button>

                {bases.length === 0 && (
                    <span className="text-[10px] text-slate-600 px-2">
                        {t('base.empty')}
                    </span>
                )}
            </div>
        </div>
    );
};

export default BaseTabBar;
