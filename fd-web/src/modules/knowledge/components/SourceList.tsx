import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, Plus } from 'lucide-react';
import type { KnowledgeSource, KnowledgeSourceType } from '../../../shared/types/server';
import SourceTypeIcon from './SourceTypeIcon';

interface SourceListProps {
    sources: KnowledgeSource[];
    selectedId?: number;
    onSelect: (source: KnowledgeSource) => void;
    onAdd: () => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    typeFilter: KnowledgeSourceType | null;
    onTypeFilterChange: (t: KnowledgeSourceType | null) => void;
}

const SYNC_STATUS_COLORS: Record<string, string> = {
    NOT_SYNCED: 'text-slate-500',
    SYNCING: 'text-amber-400',
    SYNCED: 'text-green-400',
    FAILED: 'text-red-400',
};

const SOURCE_TYPES: KnowledgeSourceType[] = ['PDF', 'URL', 'TEXT', 'CSV', 'MARKDOWN'];

const SourceList: React.FC<SourceListProps> = ({
    sources, selectedId, onSelect, onAdd,
    searchQuery, onSearchChange, typeFilter, onTypeFilterChange,
}) => {
    const { t } = useTranslation('knowledge');
    const [showTypeFilter, setShowTypeFilter] = useState(false);

    const formatSize = (bytes?: number) => {
        if (!bytes) return '';
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    };

    return (
        <div className="w-80 border-r border-white/10 flex flex-col flex-shrink-0 bg-slate-900/20">
            {/* Header: search + filter */}
            <div className="p-3 border-b border-white/10 space-y-2">
                <div className="flex items-center gap-2">
                    <div className="flex-1 relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder={t('source.search')}
                            className="w-full pl-7 pr-2 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/30 transition-colors"
                        />
                    </div>
                    <div className="relative">
                        <button
                            onClick={() => setShowTypeFilter(!showTypeFilter)}
                            className={`p-1.5 rounded-lg border transition-all ${
                                typeFilter ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-white/10 bg-white/5 text-slate-400 hover:text-white'
                            }`}
                        >
                            <Filter size={12} />
                        </button>
                        {showTypeFilter && (
                            <div className="absolute top-full right-0 mt-1 w-36 bg-slate-800 border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
                                <button
                                    onClick={() => { onTypeFilterChange(null); setShowTypeFilter(false); }}
                                    className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${!typeFilter ? 'text-amber-400 bg-amber-500/10' : 'text-slate-300 hover:bg-white/5'}`}
                                >
                                    {t('source.allTypes')}
                                </button>
                                {SOURCE_TYPES.map(st => (
                                    <button
                                        key={st}
                                        onClick={() => { onTypeFilterChange(st); setShowTypeFilter(false); }}
                                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${typeFilter === st ? 'text-amber-400 bg-amber-500/10' : 'text-slate-300 hover:bg-white/5'}`}
                                    >
                                        <SourceTypeIcon type={st} size={11} />
                                        {st}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Source list */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                {sources.map(source => (
                    <div
                        key={source.id}
                        onClick={() => onSelect(source)}
                        className={`w-full text-left p-2.5 rounded-lg transition-all border group relative cursor-pointer ${
                            selectedId === source.id
                                ? 'bg-amber-500/10 border-amber-500/30 shadow-lg shadow-amber-500/5 z-10'
                                : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/5'
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            <SourceTypeIcon type={source.sourceType} size={14} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-0.5">
                                    <span className="text-[11px] text-white font-medium truncate flex-1">{source.title}</span>
                                    <span className={`text-[9px] font-bold uppercase tracking-tighter ${SYNC_STATUS_COLORS[source.syncStatus] || 'text-slate-500'}`}>
                                        {t(`sync.${source.syncStatus === 'NOT_SYNCED' ? 'notSynced' : source.syncStatus === 'SYNCING' ? 'syncing' : source.syncStatus === 'SYNCED' ? 'synced' : 'failed'}`)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                    <span>{source.sourceType}</span>
                                    {source.fileSize && <span>{formatSize(source.fileSize)}</span>}
                                </div>
                            </div>
                        </div>

                        {selectedId === source.id && (
                            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-500 rounded-l-lg" />
                        )}
                    </div>
                ))}
                {sources.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                        <p className="text-xs">{t('source.empty')}</p>
                        <p className="text-[10px] mt-1">{t('source.emptyHint')}</p>
                    </div>
                )}
            </div>

            {/* Bottom: Add button */}
            <div className="p-3 border-t border-white/10">
                <button
                    onClick={onAdd}
                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 text-xs font-bold rounded-lg transition-all"
                >
                    <Plus size={12} />
                    {t('source.add')}
                </button>
            </div>
        </div>
    );
};

export default SourceList;
