import React from 'react';

interface CompletedTaskCardProps {
    ticketId: number;
    externalId: string;
    subject: string;
    status: string;
    statusLabel: string;
    isSelected: boolean;
    onSelect: (id: number) => void;
}

const STATUS_COLORS: Record<string, string> = {
    completed: 'text-green-500/50',
    failed: 'text-red-500/50',
    skipped: 'text-amber-500/50',
};

const SELECTED_STYLES: Record<string, string> = {
    completed: 'bg-green-500/10 border-green-500/30',
    skipped: 'bg-amber-500/10 border-amber-500/30',
};

const CompletedTaskCard: React.FC<CompletedTaskCardProps> = ({
    ticketId, externalId, subject, status, statusLabel, isSelected, onSelect
}) => {
    const statusColor = STATUS_COLORS[status] || 'text-green-500/50';
    const selectedStyle = SELECTED_STYLES[status] || 'bg-green-500/10 border-green-500/30';

    return (
        <button
            onClick={() => onSelect(ticketId)}
            className={`w-full text-left p-2 rounded-lg transition-all border group ${
                isSelected ? selectedStyle : 'bg-white/5 border-transparent hover:bg-white/10'
            }`}
        >
            <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-bold text-slate-500 opacity-60 group-hover:opacity-100 transition-opacity">
                    #{externalId}
                </span>
                <span className={`text-[9px] font-black uppercase tracking-tighter ${statusColor}`}>
                    {statusLabel}
                </span>
            </div>
            <div className="text-[11px] text-slate-400 truncate group-hover:text-slate-200 transition-colors">
                {subject}
            </div>
        </button>
    );
};

export default CompletedTaskCard;
