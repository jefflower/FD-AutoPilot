import React from 'react';

export const StatusBadge: React.FC<{ status: number }> = ({ status }) => {
    const statusMap: Record<number, { label: string; color: string }> = {
        2: { label: 'Open', color: 'bg-green-500' },
        3: { label: 'Pending', color: 'bg-yellow-500' },
        4: { label: 'Resolved', color: 'bg-blue-500' },
        5: { label: 'Closed', color: 'bg-gray-500' },
    };
    const s = statusMap[status] || { label: 'Unknown', color: 'bg-gray-400' };
    return (
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${s.color} text-white flex-shrink-0`}>
            {s.label}
        </span>
    );
};

export const LangLabel: React.FC<{ lang: string }> = ({ lang }) => {
    const labels: Record<string, { label: string; color: string }> = {
        'cn': { label: 'ZH', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
        'en': { label: 'EN', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
    };
    const l = labels[lang] || { label: lang.toUpperCase(), color: 'bg-slate-500/20 text-slate-400 border-slate-500/30' };
    return (
        <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${l.color} flex-shrink-0`}>
            {l.label}
        </span>
    );
};

interface NavButtonProps {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}

export const NavButton: React.FC<NavButtonProps> = ({ active, onClick, icon, label }) => (
    <button
        onClick={onClick}
        className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200 group relative ${active ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
    >
        {icon}
        <span className="absolute left-14 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 transition-all pointer-events-none">
            {label}
        </span>
    </button>
);
