import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, FolderOpen } from 'lucide-react';
import type { KnowledgeGroup } from '../../../shared/types/server';

interface GroupPanelProps {
    groups: KnowledgeGroup[];
    activeGroup: KnowledgeGroup | null;
    onSelect: (group: KnowledgeGroup) => void;
    onCreate: () => void;
    onEdit: (group: KnowledgeGroup) => void;
    onDelete: (group: KnowledgeGroup) => void;
}

const GroupPanel: React.FC<GroupPanelProps> = ({
    groups, activeGroup, onSelect, onCreate, onEdit, onDelete,
}) => {
    const { t } = useTranslation('knowledge');
    const [hoveredId, setHoveredId] = useState<number | null>(null);

    return (
        <div className="w-56 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/30">
            {/* Header */}
            <div className="px-3 py-3 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {t('group.title')}
                    </span>
                </div>
            </div>

            {/* Group list */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
                {groups.map(group => (
                    <div
                        key={group.id}
                        onClick={() => onSelect(group)}
                        onMouseEnter={() => setHoveredId(group.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        className={`flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition-all group relative ${
                            activeGroup?.id === group.id
                                ? 'bg-amber-500/10 border border-amber-500/30 shadow-sm shadow-amber-500/5'
                                : 'border border-transparent hover:bg-white/5 hover:border-white/5'
                        }`}
                    >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            {group.color ? (
                                <span
                                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: group.color }}
                                />
                            ) : (
                                <FolderOpen size={12} className="text-slate-500 flex-shrink-0" />
                            )}
                            <span className={`text-xs truncate ${
                                activeGroup?.id === group.id ? 'text-amber-300 font-bold' : 'text-white'
                            }`}>
                                {group.name}
                            </span>
                        </div>

                        {/* Hover actions */}
                        {hoveredId === group.id && (
                            <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
                                <button
                                    onClick={(e) => { e.stopPropagation(); onEdit(group); }}
                                    className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                                >
                                    <Pencil size={10} />
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onDelete(group); }}
                                    className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                                >
                                    <Trash2 size={10} />
                                </button>
                            </div>
                        )}

                        {/* Active indicator */}
                        {activeGroup?.id === group.id && (
                            <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-amber-500 rounded-r" />
                        )}
                    </div>
                ))}

                {groups.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-600">
                        <FolderOpen size={20} className="mb-2 opacity-30" />
                        <p className="text-[10px]">{t('group.empty')}</p>
                        <p className="text-[9px] mt-0.5 text-slate-700">{t('group.emptyHint')}</p>
                    </div>
                )}
            </div>

            {/* Bottom: Create button */}
            <div className="p-2 border-t border-white/10">
                <button
                    onClick={onCreate}
                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-amber-300 text-xs font-bold rounded-lg transition-all border border-white/5 hover:border-amber-500/20"
                >
                    <Plus size={12} />
                    {t('group.create')}
                </button>
            </div>
        </div>
    );
};

export default GroupPanel;
