import React from 'react';

interface DetailEmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    subtitle?: string;
}

const DEFAULT_ICON = (
    <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
    </svg>
);

const DetailEmptyState: React.FC<DetailEmptyStateProps> = ({ icon, title, subtitle }) => (
    <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-4">
        <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center">
            {icon || DEFAULT_ICON}
        </div>
        <p className="text-sm font-medium">{title}</p>
        {subtitle && <p className="text-xs text-slate-700">{subtitle}</p>}
    </div>
);

export default DetailEmptyState;
