import React from 'react';

type ThemeColor = 'cyan' | 'orange' | 'pink' | 'emerald' | 'indigo';

interface TaskStatusBadgeProps {
    isActive: boolean;
    activeLabel: string;
    inactiveLabel: string;
    color: ThemeColor;
    onClick?: () => void;
    disabled?: boolean;
}

const ACTIVE_STYLES: Record<ThemeColor, string> = {
    cyan: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
    orange: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
    pink: 'bg-pink-500/20 text-pink-400 border border-pink-500/30',
    emerald: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    indigo: 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30',
};

const INACTIVE_STYLE = 'bg-slate-800 text-slate-500 border border-white/5';

const TaskStatusBadge: React.FC<TaskStatusBadgeProps> = ({
    isActive, activeLabel, inactiveLabel, color, onClick, disabled
}) => {
    const className = `px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
        isActive ? ACTIVE_STYLES[color] : INACTIVE_STYLE
    }`;

    if (onClick) {
        return (
            <button onClick={onClick} disabled={disabled} className={className}>
                {isActive ? activeLabel : inactiveLabel}
            </button>
        );
    }

    return (
        <div className={className}>
            {isActive ? activeLabel : inactiveLabel}
        </div>
    );
};

export default TaskStatusBadge;
